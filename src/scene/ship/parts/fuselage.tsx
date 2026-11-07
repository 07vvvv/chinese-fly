/* eslint-disable react/no-unknown-property */
import { useMemo } from 'react';
import * as THREE from 'three';
import { makeDecalTexture, useShipMaterials } from '../materials';

/* ------------------------------------------------------------------------- */
/* Shared hard-surface geometry kit.                                          */
/* Exported so cockpit.tsx / internals.tsx can build matching language.       */
/* ------------------------------------------------------------------------- */

export type Vec3 = [number, number, number];

export interface HullSection {
  z: number;
  /** Half width of the section. */
  w: number;
  /** Height above the section centre line. */
  top: number;
  /** Depth below the section centre line (negative). */
  bot: number;
  /** Superellipse exponent: 2 = ellipse, higher = boxier armour section. */
  e?: number;
  /** Section centre line, useful for offsets such as a ventral pod. */
  yc?: number;
}

interface ResolvedSection {
  z: number;
  w: number;
  top: number;
  bot: number;
  e: number;
  yc: number;
}

const TWO_PI = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

export function vec(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function powSigned(value: number, exponent: number) {
  const a = Math.abs(value);
  if (a < 1e-7) return 0;
  return Math.sign(value) * Math.pow(a, exponent);
}

/** Smoothly resolve a cross section at an arbitrary z through the profile. */
export function sampleSection(profile: HullSection[], z: number): ResolvedSection {
  const last = profile.length - 1;
  const zMin = profile[0].z;
  const zMax = profile[last].z;
  const zc = THREE.MathUtils.clamp(z, Math.min(zMin, zMax), Math.max(zMin, zMax));

  let i = 0;
  if (zc <= profile[0].z) {
    i = 0;
  } else if (zc >= profile[last].z) {
    i = last - 1;
  } else {
    while (i < last - 1 && zc > profile[i + 1].z) i += 1;
  }

  const s0 = profile[i];
  const s1 = profile[i + 1];
  const span = s1.z - s0.z;
  const u = span === 0 ? 0 : THREE.MathUtils.clamp((zc - s0.z) / span, 0, 1);
  const p0 = profile[Math.max(i - 1, 0)];
  const p3 = profile[Math.min(i + 2, last)];

  const mix = (a: number, b: number, c: number, d: number) => catmullRom(a, b, c, d, u);

  return {
    z: zc,
    w: Math.max(0.004, mix(p0.w, s0.w, s1.w, p3.w)),
    top: Math.max(0.004, mix(p0.top, s0.top, s1.top, p3.top)),
    bot: Math.min(-0.004, mix(p0.bot, s0.bot, s1.bot, p3.bot)),
    e: Math.max(1.5, mix(p0.e ?? 3, s0.e ?? 3, s1.e ?? 3, p3.e ?? 3)),
    yc: mix(p0.yc ?? 0, s0.yc ?? 0, s1.yc ?? 0, p3.yc ?? 0),
  };
}

/**
 * Point on a lofted hull surface.
 * t = 0 is the top centre line, 0.25 starboard equator, 0.5 keel, 0.75 port.
 */
export function surfacePoint(
  profile: HullSection[],
  z: number,
  t: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const section = sampleSection(profile, z);
  const phi = t * TWO_PI;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const exponent = 2 / section.e;
  const x = section.w * powSigned(s, exponent);
  const amp = c >= 0 ? section.top : section.bot;
  const y = section.yc + amp * Math.pow(Math.abs(c), exponent);
  return out.set(x, y, z);
}

/** Outward surface normal, evaluated numerically from the loft parameterisation. */
export function surfaceNormal(
  profile: HullSection[],
  z: number,
  t: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const dz = 0.04;
  const dt = 0.0016;
  const p = surfacePoint(profile, z, t);
  const tangentZ = surfacePoint(profile, z + dz, t).sub(p);
  const tangentT = surfacePoint(profile, z, t + dt).sub(p);
  out.crossVectors(tangentZ, tangentT);
  if (out.lengthSq() < 1e-12) {
    const section = sampleSection(profile, z);
    out.set(p.x, p.y - section.yc, 0);
    if (out.lengthSq() < 1e-12) out.set(0, 0, 1);
  }
  return out.normalize();
}

export interface SurfaceSample {
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

export function surfaceAt(profile: HullSection[], z: number, t: number): SurfaceSample {
  const position = surfacePoint(profile, z, t);
  const normal = surfaceNormal(profile, z, t);
  return { position, normal };
}

export interface LoftOptions {
  rings?: number;
  radial?: number;
  capStart?: boolean;
  capEnd?: boolean;
}

/**
 * Guard against inverted loft / plate winding. The first triangle is always an
 * outer-skin triangle facing the same way as the local surface normal, so a
 * face-normal comparison is reliable even for wide, curved or full-ring panels
 * (vertex averages near a corner are not).
 */
function flipIfInward(geo: THREE.BufferGeometry, reference: THREE.Vector3) {
  const index = geo.getIndex();
  const position = geo.getAttribute('position');
  if (!index || !position) return;

  const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(1));
  const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(2));
  const faceNormal = b.sub(a).cross(c.sub(a)).normalize();
  if (faceNormal.dot(reference) >= 0) return;

  for (let k = 0; k < index.count; k += 3) {
    const swap = index.getX(k + 1);
    index.setX(k + 1, index.getX(k + 2));
    index.setX(k + 2, swap);
  }
  index.needsUpdate = true;
  geo.computeVertexNormals();
}

/** Closed lofted shell between two z stations. */
export function loftGeometry(
  profile: HullSection[],
  zStart: number,
  zEnd: number,
  options: LoftOptions = {},
): THREE.BufferGeometry {
  const rings = Math.max(2, options.rings ?? 26);
  const radial = Math.max(6, options.radial ?? 28);
  const zA = Math.min(zStart, zEnd);
  const zB = Math.max(zStart, zEnd);

  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];

  for (let j = 0; j <= rings; j += 1) {
    const z = THREE.MathUtils.lerp(zA, zB, j / rings);
    for (let i = 0; i < radial; i += 1) {
      const point = surfacePoint(profile, z, i / radial);
      positions.push(point.x, point.y, point.z);
      uvs.push(i / radial, j / rings);
    }
  }

  const at = (j: number, i: number) => j * radial + ((i + radial) % radial);
  for (let j = 0; j < rings; j += 1) {
    for (let i = 0; i < radial; i += 1) {
      const a = at(j, i);
      const b = at(j, i + 1);
      const c = at(j + 1, i + 1);
      const d = at(j + 1, i);
      index.push(a, c, b, a, d, c);
    }
  }

  const addCap = (ringIndex: number, facing: 1 | -1) => {
    const base = positions.length / 3;
    const z = ringIndex === 0 ? zA : zB;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < radial; i += 1) {
      const point = surfacePoint(profile, z, i / radial);
      cx += point.x;
      cy += point.y;
      positions.push(point.x, point.y, point.z);
      uvs.push(0.5 + point.x * 0.4, 0.5 + point.y * 0.4);
    }
    cx /= radial;
    cy /= radial;
    const centre = positions.length / 3;
    positions.push(cx, cy, z);
    uvs.push(0.5, 0.5);
    for (let i = 0; i < radial; i += 1) {
      const r0 = base + i;
      const r1 = base + ((i + 1) % radial);
      if (facing === -1) index.push(centre, r0, r1);
      else index.push(centre, r1, r0);
    }
  };

  if (options.capStart !== false) addCap(0, -1);
  if (options.capEnd !== false) addCap(rings, 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const reference = surfaceNormal(profile, zA + 0.02, 0.02);
  flipIfInward(geo, reference);
  return geo;
}

export interface PanelOptions {
  rise?: number;
  segZ?: number;
  segT?: number;
}

/**
 * Armour plate hugging the hull: raised outer skin plus skirts down to the
 * substrate. The inner face is left open because it sits flat on the hull.
 */
export function panelGeometry(
  profile: HullSection[],
  z0: number,
  z1: number,
  t0: number,
  t1: number,
  options: PanelOptions = {},
): THREE.BufferGeometry {
  const zA = Math.min(z0, z1);
  const zB = Math.max(z0, z1);
  const tA = Math.min(t0, t1);
  const tB = Math.max(t0, t1);
  const rise = options.rise ?? 0.025;
  const segZ = Math.max(1, options.segZ ?? 4);
  const segT = Math.max(1, options.segT ?? 3);
  const fullRing = tB - tA > 0.999;

  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];

  for (let j = 0; j <= segZ; j += 1) {
    const z = THREE.MathUtils.lerp(zA, zB, j / segZ);
    for (let i = 0; i <= segT; i += 1) {
      const t = THREE.MathUtils.lerp(tA, tB, i / segT);
      const sample = surfaceAt(profile, z, t);
      sample.position.addScaledVector(sample.normal, rise);
      positions.push(sample.position.x, sample.position.y, sample.position.z);
      uvs.push((i / segT) * 1.3, (j / segZ) * 1.3);
    }
  }

  const at = (j: number, i: number) => j * (segT + 1) + i;
  for (let j = 0; j < segZ; j += 1) {
    for (let i = 0; i < segT; i += 1) {
      const a = at(j, i);
      const b = at(j, i + 1);
      const c = at(j + 1, i + 1);
      const d = at(j + 1, i);
      index.push(a, c, b, a, d, c);
    }
  }

  const pushInner = (z: number, t: number) => {
    const sample = surfaceAt(profile, z, t);
    sample.position.addScaledVector(sample.normal, 0.003);
    positions.push(sample.position.x, sample.position.y, sample.position.z);
    uvs.push(0, 0);
    return positions.length / 3 - 1;
  };

  const quad = (q0: number, q1: number, q2: number, q3: number) => {
    index.push(q0, q1, q2, q0, q2, q3);
  };

  for (let i = 0; i < segT; i += 1) {
    const ta = THREE.MathUtils.lerp(tA, tB, i / segT);
    const tb = THREE.MathUtils.lerp(tA, tB, (i + 1) / segT);
    quad(at(0, i), at(0, i + 1), pushInner(zA, tb), pushInner(zA, ta));
    quad(at(segZ, i + 1), at(segZ, i), pushInner(zB, ta), pushInner(zB, tb));
  }

  if (!fullRing) {
    for (let j = 0; j < segZ; j += 1) {
      const za = THREE.MathUtils.lerp(zA, zB, j / segZ);
      const zb = THREE.MathUtils.lerp(zA, zB, (j + 1) / segZ);
      quad(at(j + 1, 0), at(j, 0), pushInner(za, tA), pushInner(zb, tA));
      quad(at(j, segT), at(j + 1, segT), pushInner(zb, tB), pushInner(za, tB));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const mid = surfaceNormal(
    profile,
    THREE.MathUtils.lerp(zA, zB, 0.012),
    THREE.MathUtils.lerp(tA, tB, 0.012),
  );
  flipIfInward(geo, mid);
  return geo;
}

/* ------------------------------- primitives ------------------------------ */

export function boxGeo(w: number, h: number, d: number) {
  return new THREE.BoxGeometry(w, h, d);
}

export function cylinderGeo(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments = 8,
) {
  return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1);
}

/** Translate / rotate a geometry in place. */
export function tf(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
) {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quaternion, ONE);
  geo.applyMatrix4(matrix);
  return geo;
}

/** Frame whose local Z is the surface normal, local X is roughly along the ship. */
export function flatMatrix(
  position: THREE.Vector3,
  normal: THREE.Vector3,
  upHint: THREE.Vector3 = Y_AXIS,
): THREE.Matrix4 {
  const n = normal.clone().normalize();
  const up0 = upHint.clone().normalize();
  if (Math.abs(up0.dot(n)) > 0.985) up0.set(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(up0, n).normalize();
  const up = new THREE.Vector3().crossVectors(n, right).normalize();
  const matrix = new THREE.Matrix4().makeBasis(right, up, n);
  matrix.setPosition(position);
  return matrix;
}

export function placeFlat(
  geo: THREE.BufferGeometry,
  position: THREE.Vector3,
  normal: THREE.Vector3,
  upHint: THREE.Vector3 = Y_AXIS,
) {
  geo.applyMatrix4(flatMatrix(position, normal, upHint));
  return geo;
}

/** Place a Y-axis primitive so its axis follows the given direction. */
export function placeAlong(
  geo: THREE.BufferGeometry,
  position: THREE.Vector3,
  direction: THREE.Vector3,
) {
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction.clone().normalize());
  geo.applyMatrix4(new THREE.Matrix4().compose(position, q, ONE));
  return geo;
}

export function placeBolt(
  target: THREE.BufferGeometry[],
  position: THREE.Vector3,
  normal: THREE.Vector3,
  radius = 0.012,
) {
  const bolt = new THREE.CylinderGeometry(radius, radius * 1.22, radius * 1.1, 6, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, normal.clone().normalize());
  const at = position.clone().addScaledVector(normal, radius * 0.35);
  bolt.applyMatrix4(new THREE.Matrix4().compose(at, q, ONE));
  target.push(bolt);
}

export function boltRing(
  target: THREE.BufferGeometry[],
  profile: HullSection[],
  z: number,
  count: number,
  rise: number,
  radius = 0.012,
) {
  for (let i = 0; i < count; i += 1) {
    const sample = surfaceAt(profile, z, i / count);
    sample.position.addScaledVector(sample.normal, rise);
    placeBolt(target, sample.position, sample.normal, radius);
  }
}

/** Rounded rectangle ring used for hatches, gear bays and access doors. */
export function roundedRectShape(width: number, height: number, radius: number) {
  const w = width;
  const h = height;
  const r = Math.min(radius, Math.min(w, h) / 2 - 0.001);
  const x = -w / 2;
  const y = -h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

export function ringFrameGeometry(
  width: number,
  height: number,
  radius: number,
  border: number,
  depth: number,
) {
  const outer = roundedRectShape(width, height, radius);
  const inner = roundedRectShape(
    Math.max(0.02, width - border * 2),
    Math.max(0.02, height - border * 2),
    Math.max(0.01, radius - border),
  );
  outer.holes.push(new THREE.Path(inner.getPoints(18)));
  return new THREE.ExtrudeGeometry(outer, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 1,
    curveSegments: 5,
    steps: 1,
  });
}

/* -------------------------------- merging -------------------------------- */

/**
 * Merge many small geometries into one draw call. Geometry is flattened to
 * non indexed triangles with position / normal / uv so attributes always match.
 */
export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  const parts: THREE.BufferGeometry[] = [];
  let total = 0;

  for (const source of geos) {
    const geo = source.index ? source.toNonIndexed() : source;
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    total += geo.getAttribute('position').count;
    parts.push(geo);
  }

  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  let offset = 0;

  for (const geo of parts) {
    const position = geo.getAttribute('position');
    const normal = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < position.count; i += 1) {
      const p = (offset + i) * 3;
      positions[p] = position.getX(i);
      positions[p + 1] = position.getY(i);
      positions[p + 2] = position.getZ(i);
      normals[p] = normal.getX(i);
      normals[p + 1] = normal.getY(i);
      normals[p + 2] = normal.getZ(i);
      if (uv) {
        const q = (offset + i) * 2;
        uvs[q] = uv.getX(i);
        uvs[q + 1] = uv.getY(i);
      }
    }
    offset += position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.computeBoundingSphere();
  return merged;
}

export function Merged({
  geos,
  material,
  cast = true,
  receive = true,
}: {
  geos: THREE.BufferGeometry[];
  material: THREE.Material;
  cast?: boolean;
  receive?: boolean;
}) {
  const geometry = useMemo(() => mergeGeos(geos), [geos]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} castShadow={cast} receiveShadow={receive} />;
}

/* -------------------------------- stencils ------------------------------- */

export interface StencilPlacement {
  key: string;
  texture: THREE.Texture;
  position: Vec3;
  normal: Vec3;
  width: number;
  height: number;
  up?: Vec3;
}

export function Stencil({
  texture,
  position,
  normal,
  width,
  height,
  up,
}: Omit<StencilPlacement, 'key'>) {
  const geometry = useMemo(() => new THREE.PlaneGeometry(width, height), [width, height]);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        opacity: 0.94,
        roughness: 0.64,
        metalness: 0.16,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        depthWrite: false,
      }),
    [texture],
  );
  const matrix = useMemo(() => {
    const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
    const upHint = new THREE.Vector3(...(up ?? [0, 1, 0]));
    if (Math.abs(upHint.dot(n)) > 0.985) upHint.set(0, 0, 1);
    upHint.normalize();
    const right = new THREE.Vector3().crossVectors(upHint, n).normalize();
    const upAxis = new THREE.Vector3().crossVectors(n, right).normalize();
    const m = new THREE.Matrix4().makeBasis(right, upAxis, n);
    m.setPosition(
      new THREE.Vector3(position[0], position[1], position[2]).addScaledVector(n, 0.008),
    );
    return m;
  }, [position, normal, up]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      matrixAutoUpdate={false}
      matrix={matrix}
      castShadow={false}
      receiveShadow={false}
      renderOrder={4}
    />
  );
}

/* ------------------------------------------------------------------------- */
/* Hull profiles                                                             */
/* ------------------------------------------------------------------------- */

const HULL_PROFILE: HullSection[] = [
  { z: -4.8, w: 0.48, top: 0.37, bot: -0.37, e: 3.6 },
  { z: -4.6, w: 0.6, top: 0.45, bot: -0.45, e: 3.5 },
  { z: -4.1, w: 0.76, top: 0.54, bot: -0.54, e: 3.4 },
  { z: -3.4, w: 0.9, top: 0.63, bot: -0.63, e: 3.3 },
  { z: -2.6, w: 1.0, top: 0.71, bot: -0.71, e: 3.2 },
  { z: -1.6, w: 1.1, top: 0.79, bot: -0.78, e: 3.15 },
  { z: -0.6, w: 1.16, top: 0.85, bot: -0.82, e: 3.1 },
  { z: 0.4, w: 1.2, top: 0.88, bot: -0.84, e: 3.1 },
  { z: 1.4, w: 1.22, top: 0.888, bot: -0.845, e: 3.1 },
  { z: 2.2, w: 1.21, top: 0.88, bot: -0.835, e: 3.1 },
  { z: 2.8, w: 1.16, top: 0.85, bot: -0.8, e: 3.15 },
  { z: 3.4, w: 1.07, top: 0.79, bot: -0.76, e: 3.2 },
  { z: 3.9, w: 0.94, top: 0.71, bot: -0.7, e: 3.3 },
  { z: 4.35, w: 0.79, top: 0.62, bot: -0.62, e: 3.4 },
  { z: 4.72, w: 0.61, top: 0.5, bot: -0.51, e: 3.5 },
  { z: 5.0, w: 0.51, top: 0.41, bot: -0.43, e: 3.6 },
];

const NOSE_BODY: HullSection[] = [
  { z: 4.6, w: 0.7, top: 0.58, bot: -0.59, e: 3.8 },
  { z: 4.95, w: 0.64, top: 0.53, bot: -0.54, e: 3.9 },
  { z: 5.3, w: 0.57, top: 0.46, bot: -0.47, e: 4.1 },
  { z: 5.9, w: 0.51, top: 0.4, bot: -0.42, e: 4.2 },
  { z: 6.45, w: 0.45, top: 0.34, bot: -0.36, e: 4.4 },
  { z: 6.9, w: 0.38, top: 0.28, bot: -0.3, e: 4.6 },
  { z: 7.15, w: 0.31, top: 0.22, bot: -0.25, e: 4.8 },
];

const NOSE_RADOME: HullSection[] = [
  { z: 7.12, w: 0.32, top: 0.23, bot: -0.26, e: 4.8 },
  { z: 7.35, w: 0.285, top: 0.205, bot: -0.23, e: 4.4 },
  { z: 7.62, w: 0.235, top: 0.17, bot: -0.195, e: 4.0 },
  { z: 7.88, w: 0.17, top: 0.125, bot: -0.145, e: 3.6 },
  { z: 8.08, w: 0.095, top: 0.075, bot: -0.085, e: 3.2 },
  { z: 8.2, w: 0.02, top: 0.016, bot: -0.02, e: 2.8 },
];

/* ------------------------------------------------------------------------- */
/* Detail builders                                                           */
/* ------------------------------------------------------------------------- */

function tSpan(center: number, half: number): [number, number] {
  return [center - half, center + half];
}

function addPlateRow(
  target: THREE.BufferGeometry[],
  bolts: THREE.BufferGeometry[],
  spans: [number, number][],
  t0: number,
  t1: number,
  rise: number,
  segT = 4,
) {
  for (const [z0, z1] of spans) {
    const segZ = Math.max(3, Math.round((z1 - z0) / 0.26));
    target.push(panelGeometry(HULL_PROFILE, z0, z1, t0, t1, { rise, segZ, segT }));
    const zs = [z0 + (z1 - z0) * 0.12, z0 + (z1 - z0) * 0.88];
    const ts = [t0 + (t1 - t0) * 0.16, t0 + (t1 - t0) * 0.84];
    for (const z of zs) {
      for (const t of ts) {
        const sample = surfaceAt(HULL_PROFILE, z, t);
        sample.position.addScaledVector(sample.normal, rise + 0.002);
        placeBolt(bolts, sample.position, sample.normal);
      }
    }
  }
}

function addRail(
  target: THREE.BufferGeometry[],
  bolts: THREE.BufferGeometry[],
  tCenter: number,
  half: number,
  z0: number,
  z1: number,
  rise: number,
  count = 6,
) {
  const [t0, t1] = tSpan(tCenter, half);
  target.push(
    panelGeometry(HULL_PROFILE, z0, z1, t0, t1, {
      rise,
      segZ: Math.max(4, Math.round((z1 - z0) / 0.5)),
      segT: 1,
    }),
  );
  for (let i = 0; i < count; i += 1) {
    const z = z0 + (z1 - z0) * (0.08 + (0.84 * i) / Math.max(1, count - 1));
    const sample = surfaceAt(HULL_PROFILE, z, tCenter);
    sample.position.addScaledVector(sample.normal, rise + 0.005);
    placeBolt(bolts, sample.position, sample.normal, 0.01);
  }
}

function addVent(
  housing: THREE.BufferGeometry[],
  fins: THREE.BufferGeometry[],
  zCenter: number,
  tCenter: number,
  zLength: number,
  tWidth: number,
  finCount: number,
  rise: number,
) {
  housing.push(
    panelGeometry(
      HULL_PROFILE,
      zCenter - zLength / 2,
      zCenter + zLength / 2,
      tCenter - tWidth / 2,
      tCenter + tWidth / 2,
      { rise, segZ: 3, segT: 3 },
    ),
  );
  for (let i = 0; i < finCount; i += 1) {
    const t = tCenter - tWidth / 2 + (tWidth * (i + 0.5)) / finCount;
    const sample = surfaceAt(HULL_PROFILE, zCenter, t);
    sample.position.addScaledVector(sample.normal, rise + 0.006);
    fins.push(placeFlat(boxGeo(zLength * 0.86, (tWidth / finCount) * 0.55, 0.03), sample.position, sample.normal));
  }
}

function addHatch(
  frame: THREE.BufferGeometry[],
  panel: THREE.BufferGeometry[],
  bolts: THREE.BufferGeometry[],
  z: number,
  t: number,
  width: number,
  height: number,
  rise: number,
) {
  const sample = surfaceAt(HULL_PROFILE, z, t);
  const matrix = flatMatrix(sample.position.clone().addScaledVector(sample.normal, rise), sample.normal);
  const push = (list: THREE.BufferGeometry[], geo: THREE.BufferGeometry) => {
    geo.applyMatrix4(matrix);
    list.push(geo);
  };

  push(frame, ringFrameGeometry(width, height, 0.08, 0.034, 0.022));
  push(panel, tf(boxGeo(width - 0.07, height - 0.07, 0.018), 0, 0, 0.006));
  push(frame, tf(cylinderGeo(0.019, 0.019, 0.07, 8), -width * 0.3, height * 0.5 - 0.02, 0.03, 0, 0, Math.PI / 2));
  push(frame, tf(cylinderGeo(0.019, 0.019, 0.07, 8), width * 0.3, height * 0.5 - 0.02, 0.03, 0, 0, Math.PI / 2));
  push(frame, tf(boxGeo(0.1, 0.028, 0.03), 0, -height * 0.44, 0.028));

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const local = new THREE.Vector3(sx * (width / 2 - 0.022), sy * (height / 2 - 0.018), 0.03);
      const world = local.clone().applyMatrix4(matrix);
      placeBolt(bolts, world, sample.normal, 0.009);
    }
  }
}

function addRcsCluster(
  dark: THREE.BufferGeometry[],
  trim: THREE.BufferGeometry[],
  z: number,
  t: number,
) {
  const sample = surfaceAt(HULL_PROFILE, z, t);
  const matrix = flatMatrix(sample.position.clone().addScaledVector(sample.normal, 0.008), sample.normal);
  for (let i = -1; i <= 1; i += 1) {
    const world = new THREE.Vector3(i * 0.115, 0, 0).applyMatrix4(matrix);
    dark.push(placeAlong(cylinderGeo(0.045, 0.05, 0.03, 10), world, sample.normal));
    dark.push(
      placeAlong(
        cylinderGeo(0.026, 0.026, 0.02, 10),
        world.clone().addScaledVector(sample.normal, 0.018),
        sample.normal,
      ),
    );
    trim.push(
      placeFlat(
        new THREE.TorusGeometry(0.044, 0.007, 5, 12),
        world.clone().addScaledVector(sample.normal, 0.031),
        sample.normal,
      ),
    );
  }
}

function addConduit(
  target: THREE.BufferGeometry[],
  clamps: THREE.BufferGeometry[],
  t: number,
  z0: number,
  z1: number,
  radius: number,
) {
  const points: THREE.Vector3[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i += 1) {
    const z = THREE.MathUtils.lerp(z0, z1, i / steps);
    const sample = surfaceAt(HULL_PROFILE, z, t);
    points.push(sample.position.clone().addScaledVector(sample.normal, 0.03));
  }
  target.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 26, radius, 6, false));

  const clampCount = Math.max(2, Math.round((z1 - z0) / 0.65));
  for (let i = 0; i <= clampCount; i += 1) {
    const z = THREE.MathUtils.lerp(z0 + 0.2, z1 - 0.2, i / clampCount);
    const sample = surfaceAt(HULL_PROFILE, z, t);
    sample.position.addScaledVector(sample.normal, 0.03);
    clamps.push(placeFlat(boxGeo(0.055, 0.055, 0.05), sample.position, sample.normal));
  }
}

interface FuselageBuilt {
  hull: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  dark: THREE.BufferGeometry[];
  ceramic: THREE.BufferGeometry[];
  accent: THREE.BufferGeometry[];
  black: THREE.BufferGeometry[];
  glowCyan: THREE.BufferGeometry[];
  glowOrange: THREE.BufferGeometry[];
}

export function buildFuselage(): FuselageBuilt {
  const hull: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const ceramic: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const black: THREE.BufferGeometry[] = [];
  const glowCyan: THREE.BufferGeometry[] = [];
  const glowOrange: THREE.BufferGeometry[] = [];

  /* Primary skinned shell: continuous silhouette, textured substrate. */
  trim.push(loftGeometry(HULL_PROFILE, -4.8, 5.0, { rings: 46, radial: 34 }));

  /* Recessed panel seam network. */
  for (const t of [0.094, -0.094, 0.29, -0.29, 0.5]) {
    dark.push(
      panelGeometry(HULL_PROFILE, -4.58, 4.86, t - 0.006, t + 0.006, {
        rise: 0.005,
        segZ: 22,
        segT: 1,
      }),
    );
  }
  for (const z of [-3.62, -2.52, -1.42, -0.32, 0.78, 1.88, 2.98, 4.08]) {
    dark.push(
      panelGeometry(HULL_PROFILE, z - 0.012, z + 0.012, 0.004, 0.996, {
        rise: 0.004,
        segZ: 1,
        segT: 30,
      }),
    );
  }

  /* Layered armour plate rows. */
  const upperSpans: [number, number][] = [
    [-4.35, -3.45],
    [-3.35, -2.3],
    [-2.2, -1.05],
    [-0.95, 0.15],
    [0.25, 1.35],
    [1.45, 2.55],
    [2.65, 3.55],
  ];
  const lowerSpans: [number, number][] = [
    [-4.3, -3.5],
    [-3.4, -2.2],
    [-2.1, -0.8],
    [-0.7, 0.55],
    [0.65, 1.85],
    [1.95, 3.05],
  ];

  addPlateRow(hull, trim, upperSpans, 0.105, 0.19, 0.03);
  addPlateRow(hull, trim, upperSpans, -0.19, -0.105, 0.03);
  addPlateRow(hull, trim, lowerSpans, 0.305, 0.39, 0.024);
  addPlateRow(hull, trim, lowerSpans, -0.39, -0.305, 0.024);
  addPlateRow(ceramic, trim, [[3.65, 4.55]], 0.105, 0.19, 0.038);
  addPlateRow(ceramic, trim, [[3.65, 4.55]], -0.19, -0.105, 0.038);
  addPlateRow(ceramic, trim, [[3.15, 4.3]], 0.305, 0.39, 0.032);
  addPlateRow(ceramic, trim, [[3.15, 4.3]], -0.39, -0.305, 0.032);
  addPlateRow(hull, trim, [[-4.72, -3.85]], -0.082, 0.082, 0.03, 2);
  addPlateRow(ceramic, trim, [[4.32, 4.6]], -0.07, 0.07, 0.036, 2);
  addPlateRow(
    dark,
    trim,
    [
      [-4.25, -3.2],
      [-3.1, -2.15],
      [2.3, 3.4],
      [3.5, 4.5],
    ],
    0.445,
    0.492,
    0.018,
    2,
  );
  addPlateRow(
    dark,
    trim,
    [
      [-4.25, -3.2],
      [-3.1, -2.15],
      [2.3, 3.4],
      [3.5, 4.5],
    ],
    0.508,
    0.555,
    0.018,
    2,
  );

  /* Wing root doublers leave a socket band free of armour for the wing module. */
  addPlateRow(dark, trim, [[-2.95, 0.35]], 0.248, 0.298, 0.012, 2);
  addPlateRow(dark, trim, [[-2.95, 0.35]], -0.298, -0.248, 0.012, 2);

  /* Longitudinal shoulder strakes. */
  for (const side of [1, -1]) {
    const [s0, s1] = tSpan(side * 0.207, 0.011);
    trim.push(
      panelGeometry(HULL_PROFILE, -3.95, 4.45, s0, s1, { rise: 0.045, segZ: 26, segT: 1 }),
    );
    const [b0, b1] = tSpan(side * 0.404, 0.012);
    trim.push(
      panelGeometry(HULL_PROFILE, -3.9, 4.55, b0, b1, { rise: 0.03, segZ: 26, segT: 1 }),
    );
    for (let i = 0; i < 9; i += 1) {
      const z = -3.6 + i * 0.92;
      const sample = surfaceAt(HULL_PROFILE, z, side * 0.207);
      sample.position.addScaledVector(sample.normal, 0.052);
      placeBolt(trim, sample.position, sample.normal, 0.01);
    }
  }

  /* Interface rails: cockpit saddle, dorsal spine seat, ventral pod rails. */
  addRail(trim, trim, 0.062, 0.013, 1.95, 4.35, 0.014, 5);
  addRail(trim, trim, -0.062, 0.013, 1.95, 4.35, 0.014, 5);
  addRail(dark, trim, 0.05, 0.012, -3.55, 1.95, 0.022, 8);
  addRail(dark, trim, -0.05, 0.012, -3.55, 1.95, 0.022, 8);
  addRail(dark, trim, 0.48, 0.008, -2.15, 2.35, 0.026, 7);
  addRail(dark, trim, 0.52, 0.008, -2.15, 2.35, 0.026, 7);

  /* Cockpit bay cross braces stay behind when the cockpit is exploded. */
  for (const [z0, z1] of [
    [2.02, 2.08],
    [3.1, 3.16],
    [4.2, 4.26],
  ]) {
    trim.push(panelGeometry(HULL_PROFILE, z0, z1, -0.07, 0.07, { rise: 0.012, segZ: 1, segT: 8 }));
  }

  /* Ventilation grilles. */
  addVent(dark, trim, -2.85, 0.16, 0.85, 0.07, 7, 0.028);
  addVent(dark, trim, -2.85, -0.16, 0.85, 0.07, 7, 0.028);
  addVent(dark, trim, -4.12, 0.17, 0.5, 0.06, 5, 0.024);
  addVent(dark, trim, -4.12, -0.17, 0.5, 0.06, 5, 0.024);
  addVent(dark, trim, 3.25, 0.155, 0.36, 0.05, 4, 0.02);
  addVent(dark, trim, 3.25, -0.155, 0.36, 0.05, 4, 0.02);

  /* Maintenance hatches. */
  addHatch(trim, dark, trim, -1.32, 0.348, 0.6, 0.3, 0.05);
  addHatch(trim, dark, trim, -1.32, -0.348, 0.6, 0.3, 0.05);
  addHatch(trim, dark, trim, 1.15, 0.348, 0.46, 0.24, 0.05);
  addHatch(trim, dark, trim, 1.15, -0.348, 0.46, 0.24, 0.05);
  addHatch(trim, dark, trim, 3.55, 0.47, 0.42, 0.22, 0.045);

  /* RCS thruster clusters. */
  for (const side of [1, -1]) {
    addRcsCluster(dark, trim, 4.42, side * 0.135);
    addRcsCluster(dark, trim, -4.3, side * 0.14);
    addRcsCluster(dark, trim, 0.9, side * 0.44);
  }

  /* Ventral / side conduit runs. */
  for (const side of [1, -1]) {
    addConduit(trim, dark, side * 0.43, -3.7, -2.05, 0.018);
    addConduit(trim, dark, side * 0.43, 2.4, 4.2, 0.018);
    addConduit(trim, dark, side * 0.463, -3.55, -2.1, 0.013);
    addConduit(trim, dark, side * 0.463, 2.35, 4.05, 0.013);
  }

  /* Mechanical greebles riding the substrate between plate rows. */
  const random = mulberry32(0x51ed270b);
  for (let i = 0; i < 72; i += 1) {
    const upper = i % 2 === 0;
    const z = -3.9 + random() * 8.2;
    const side = random() < 0.5 ? 1 : -1;
    const t = side * (upper ? 0.2 + random() * 0.085 : 0.397 + random() * 0.062);
    if (!upper && z > -2.0 && z < 2.35) continue;
    const sample = surfaceAt(HULL_PROFILE, z, t);
    const world = sample.position.clone().addScaledVector(sample.normal, 0.008);
    const w = 0.06 + random() * 0.2;
    const h = 0.035 + random() * 0.08;
    const d = 0.02 + random() * 0.05;
    if (random() > 0.74) {
      trim.push(placeAlong(cylinderGeo(0.016 + random() * 0.026, 0.016 + random() * 0.026, d + 0.03, 8), world, sample.normal));
    } else {
      trim.push(placeFlat(boxGeo(w, h, d), world, sample.normal));
    }
  }

  /* Fin carry-through saddle and aft avionics deck. */
  trim.push(tf(boxGeo(0.66, 0.18, 0.64), 0, 0.62, -4.46));
  trim.push(tf(boxGeo(0.5, 0.09, 0.36), 0, 0.72, -4.5));
  dark.push(tf(boxGeo(0.4, 0.05, 0.22), 0, 0.77, -4.52));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      placeBolt(trim, new THREE.Vector3(sx * 0.24, 0.715, -4.46 + sz * 0.24), Y_AXIS, 0.012);
    }
  }

  /* Forward hull / nose socket shadow. */
  dark.push(
    panelGeometry(HULL_PROFILE, 4.62, 4.72, 0.004, 0.996, { rise: 0.018, segZ: 1, segT: 30 }),
  );
  boltRing(trim, HULL_PROFILE, 4.68, 18, 0.026, 0.011);
  for (const side of [1, -1]) {
    const sample = surfaceAt(HULL_PROFILE, 4.76, side * 0.2);
    sample.position.addScaledVector(sample.normal, 0.012);
    trim.push(placeFlat(boxGeo(0.06, 0.16, 0.08), sample.position, sample.normal));
  }

  /* Aft bulkhead: structural frame, ribs, APU and heat shield. */
  trim.push(tf(cylinderGeo(0.43, 0.46, 0.08, 30), 0, 0, -4.8, Math.PI / 2, 0, 0));
  dark.push(tf(cylinderGeo(0.34, 0.34, 0.04, 30), 0, 0, -4.835, Math.PI / 2, 0, 0));
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * TWO_PI;
    trim.push(
      tf(
        boxGeo(0.055, 0.24, 0.05),
        Math.cos(angle) * 0.21,
        Math.sin(angle) * 0.21,
        -4.795,
        0,
        0,
        angle,
      ),
    );
  }
  dark.push(tf(cylinderGeo(0.13, 0.15, 0.06, 14), 0, 0, -4.84, Math.PI / 2, 0, 0));
  trim.push(
    placeFlat(
      new THREE.TorusGeometry(0.1, 0.012, 6, 20),
      new THREE.Vector3(0, 0, -4.878),
      new THREE.Vector3(0, 0, -1),
    ),
  );
  glowCyan.push(
    placeFlat(
      new THREE.TorusGeometry(0.062, 0.007, 5, 16),
      new THREE.Vector3(0, 0, -4.881),
      new THREE.Vector3(0, 0, -1),
    ),
  );
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * TWO_PI;
    placeBolt(
      trim,
      new THREE.Vector3(Math.cos(angle) * 0.375, Math.sin(angle) * 0.375, -4.845),
      new THREE.Vector3(0, 0, -1),
      0.012,
    );
  }

  /* Running lights along the shoulder strakes. */
  for (const side of [1, -1]) {
    for (let i = 0; i < 6; i += 1) {
      const z = -3.2 + i * 1.42;
      const sample = surfaceAt(HULL_PROFILE, z, side * 0.2165);
      sample.position.addScaledVector(sample.normal, 0.05);
      glowCyan.push(placeFlat(boxGeo(0.07, 0.02, 0.018), sample.position, sample.normal));
    }
    const aft = surfaceAt(HULL_PROFILE, -3.9, side * 0.24);
    aft.position.addScaledVector(aft.normal, 0.02);
    glowOrange.push(placeFlat(boxGeo(0.06, 0.024, 0.02), aft.position, aft.normal));
  }

  /* Small accent tags for weapons / service interfaces. */
  for (const side of [1, -1]) {
    const sample = surfaceAt(HULL_PROFILE, -0.2, side * 0.345);
    sample.position.addScaledVector(sample.normal, 0.034);
    accent.push(placeFlat(boxGeo(0.16, 0.05, 0.006), sample.position, sample.normal));
  }

  /* Antenna blades on the aft deck. */
  for (const side of [1, -1]) {
    trim.push(
      tf(boxGeo(0.02, 0.12, 0.2), side * 0.22, 0.72, -3.95, 0.22, 0, side * 0.15),
    );
  }

  black.push(tf(boxGeo(0.55, 0.012, 0.35), 0, -0.848, 0.2));
  return { hull, trim, dark, ceramic, accent, black, glowCyan, glowOrange };
}

function buildFuselageStencils(): StencilPlacement[] {
  const primary = makeDecalTexture(['AX-09', 'HELIOS'], { width: 512, height: 256 });
  const warning = makeDecalTexture(['DANGER', 'PLASMA BUS'], {
    width: 512,
    height: 256,
    color: '#e6d6c4',
  });
  const dock = makeDecalTexture(['ORBITAL DRYDOCK 07', 'ASTRAEUS DYNAMICS'], {
    width: 1024,
    height: 256,
    align: 'center',
  });

  const place = (z: number, t: number, lift: number, width: number, height: number) => {
    const sample = surfaceAt(HULL_PROFILE, z, t);
    const position = sample.position.clone().addScaledVector(sample.normal, lift);
    return { position: vec(position), normal: vec(sample.normal), width, height };
  };

  const top = surfaceAt(HULL_PROFILE, -2.9, 0.0);
  return [
    {
      key: 'hull-stbd',
      texture: primary,
      ...place(1.85, 0.152, 0.034, 1.15, 0.56),
    },
    {
      key: 'hull-port',
      texture: primary,
      ...place(1.85, -0.152, 0.034, 1.15, 0.56),
    },
    {
      key: 'hull-warn-stbd',
      texture: warning,
      ...place(-0.95, 0.347, 0.032, 0.9, 0.4),
    },
    {
      key: 'hull-warn-port',
      texture: warning,
      ...place(-0.95, -0.347, 0.032, 0.9, 0.4),
    },
    {
      key: 'hull-dock',
      texture: dock,
      position: vec(top.position.clone().addScaledVector(top.normal, 0.036)),
      normal: vec(top.normal),
      width: 1.3,
      height: 0.32,
      up: [0, 0, 1],
    },
  ];
}

export function Fuselage() {
  const materials = useShipMaterials();
  const built = useMemo(buildFuselage, []);
  const stencils = useMemo(buildFuselageStencils, []);

  return (
    <group name="hull-primary">
      <Merged geos={built.trim} material={materials.trim} />
      <Merged geos={built.hull} material={materials.hull} />
      <Merged geos={built.dark} material={materials.dark} />
      <Merged geos={built.ceramic} material={materials.ceramic} />
      <Merged geos={built.accent} material={materials.accent} />
      <Merged geos={built.black} material={materials.black} />
      <Merged geos={built.glowCyan} material={materials.glowCyan} cast={false} receive={false} />
      <Merged geos={built.glowOrange} material={materials.glowOrange} cast={false} receive={false} />
      {stencils.map(({ key, ...rest }) => (
        <Stencil key={key} {...rest} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------------- */
/* Forward sensor array                                                      */
/* ------------------------------------------------------------------------- */

interface NoseBuilt {
  body: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  dark: THREE.BufferGeometry[];
  ceramic: THREE.BufferGeometry[];
  black: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
  accent: THREE.BufferGeometry[];
  glowCyan: THREE.BufferGeometry[];
  glowOrange: THREE.BufferGeometry[];
}

function addAesaPanel(
  frame: THREE.BufferGeometry[],
  aperture: THREE.BufferGeometry[],
  trim: THREE.BufferGeometry[],
  glow: THREE.BufferGeometry[],
  tCenter: number,
  zCenter: number,
  zLength: number,
  tWidth: number,
) {
  frame.push(
    panelGeometry(
      NOSE_BODY,
      zCenter - zLength / 2 - 0.05,
      zCenter + zLength / 2 + 0.05,
      tCenter - tWidth / 2 - 0.014,
      tCenter + tWidth / 2 + 0.014,
      { rise: 0.012, segZ: 5, segT: 4 },
    ),
  );
  aperture.push(
    panelGeometry(
      NOSE_BODY,
      zCenter - zLength / 2,
      zCenter + zLength / 2,
      tCenter - tWidth / 2,
      tCenter + tWidth / 2,
      { rise: 0.026, segZ: 5, segT: 4 },
    ),
  );
  for (const offset of [-0.34, 0, 0.34]) {
    const t = tCenter + offset * tWidth;
    trim.push(
      panelGeometry(
        NOSE_BODY,
        zCenter - zLength / 2 + 0.04,
        zCenter + zLength / 2 - 0.04,
        t - 0.006,
        t + 0.006,
        { rise: 0.034, segZ: 5, segT: 1 },
      ),
    );
  }
  const status = surfaceAt(NOSE_BODY, zCenter, tCenter);
  status.position.addScaledVector(status.normal, 0.037);
  glow.push(placeFlat(boxGeo(0.05, 0.05, 0.006), status.position, status.normal));
}

function addSensorPort(
  trim: THREE.BufferGeometry[],
  glass: THREE.BufferGeometry[],
  dark: THREE.BufferGeometry[],
  z: number,
  t: number,
  radius = 0.05,
) {
  const sample = surfaceAt(NOSE_BODY, z, t);
  const base = sample.position.clone().addScaledVector(sample.normal, 0.014);
  trim.push(placeAlong(cylinderGeo(radius, radius * 1.08, 0.024, 14), base, sample.normal));
  dark.push(
    placeAlong(cylinderGeo(radius * 0.8, radius * 0.8, 0.01, 14), base, sample.normal),
  );
  glass.push(
    placeAlong(
      cylinderGeo(radius * 0.72, radius * 0.72, 0.01, 14),
      base.clone().addScaledVector(sample.normal, 0.014),
      sample.normal,
    ),
  );
  trim.push(
    placeFlat(
      new THREE.TorusGeometry(radius * 1.02, 0.007, 5, 16),
      base.clone().addScaledVector(sample.normal, 0.016),
      sample.normal,
    ),
  );
}

export function buildNose(): NoseBuilt {
  const body: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const ceramic: THREE.BufferGeometry[] = [];
  const black: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const glowCyan: THREE.BufferGeometry[] = [];
  const glowOrange: THREE.BufferGeometry[] = [];

  /* Sensor module shell sleeves over the forward hull socket. */
  body.push(loftGeometry(NOSE_BODY, 4.6, 7.15, { rings: 26, radial: 32 }));
  ceramic.push(loftGeometry(NOSE_RADOME, 7.12, 8.2, { rings: 22, radial: 30 }));

  /* Mounting flange with captive fasteners. */
  trim.push(
    panelGeometry(NOSE_BODY, 4.6, 4.72, 0.002, 0.998, { rise: 0.03, segZ: 1, segT: 32 }),
  );
  dark.push(
    panelGeometry(NOSE_BODY, 4.725, 4.755, 0.002, 0.998, { rise: 0.008, segZ: 1, segT: 32 }),
  );
  boltRing(trim, NOSE_BODY, 4.665, 22, 0.042, 0.011);

  /* AESA apertures: starboard, port, dorsal, ventral. */
  addAesaPanel(trim, black, trim, glowCyan, 0.182, 6.18, 1.12, 0.1);
  addAesaPanel(trim, black, trim, glowCyan, -0.182, 6.18, 1.12, 0.1);
  addAesaPanel(trim, black, trim, glowCyan, 0.0, 6.1, 0.86, 0.085);
  addAesaPanel(trim, black, trim, glowCyan, 0.5, 6.22, 0.86, 0.085);

  /* Radome seams and tile divisions. */
  for (const z of [7.32, 7.66, 7.95]) {
    dark.push(
      panelGeometry(NOSE_RADOME, z - 0.012, z + 0.012, 0.002, 0.998, {
        rise: 0.005,
        segZ: 1,
        segT: 26,
      }),
    );
  }
  boltRing(trim, NOSE_RADOME, 7.21, 16, 0.02, 0.009);
  for (const side of [1, -1]) {
    for (const z of [7.24, 7.52]) {
      const sample = surfaceAt(NOSE_RADOME, z, side * 0.12);
      sample.position.addScaledVector(sample.normal, 0.012);
      placeBolt(trim, sample.position, sample.normal, 0.009);
    }
  }
  /* Radome tip sensor. */
  const tip = surfaceAt(NOSE_RADOME, 8.06, 0.0);
  dark.push(placeAlong(cylinderGeo(0.035, 0.045, 0.05, 10), tip.position.clone().addScaledVector(tip.normal, 0.02), tip.normal));
  glowOrange.push(
    placeFlat(
      new THREE.TorusGeometry(0.024, 0.006, 5, 14),
      tip.position.clone().addScaledVector(tip.normal, 0.045),
      tip.normal,
    ),
  );

  /* Electro optical windows. */
  addSensorPort(trim, glass, dark, 5.4, 0.2, 0.055);
  addSensorPort(trim, glass, dark, 5.4, -0.2, 0.055);
  addSensorPort(trim, glass, dark, 6.98, 0.21, 0.048);
  addSensorPort(trim, glass, dark, 6.98, -0.21, 0.048);
  addSensorPort(trim, glass, dark, 6.98, 0.54, 0.042);
  addSensorPort(trim, glass, dark, 5.55, 0.0, 0.05);
  addSensorPort(trim, glass, dark, 6.62, -0.05, 0.038);

  /* Star tracker on the dorsal spine. */
  const tracker = surfaceAt(NOSE_BODY, 6.18, 0.0);
  const trackerBase = tracker.position.clone().addScaledVector(tracker.normal, 0.02);
  trim.push(placeAlong(cylinderGeo(0.072, 0.085, 0.06, 12), trackerBase, tracker.normal));
  trim.push(
    placeFlat(
      new THREE.TorusGeometry(0.062, 0.009, 5, 16),
      trackerBase.clone().addScaledVector(tracker.normal, 0.032),
      tracker.normal,
    ),
  );
  const dome = new THREE.SphereGeometry(0.058, 12, 6, 0, TWO_PI, 0, Math.PI / 2);
  glass.push(placeAlong(dome, trackerBase.clone().addScaledVector(tracker.normal, 0.03), tracker.normal));

  /* Longitudinal strakes and side chines. */
  for (const side of [1, -1]) {
    trim.push(
      panelGeometry(NOSE_BODY, 5.05, 6.9, side * 0.094 - 0.006, side * 0.094 + 0.006, {
        rise: 0.026,
        segZ: 12,
        segT: 1,
      }),
    );
    trim.push(
      panelGeometry(NOSE_BODY, 5.05, 6.9, side * 0.272 - 0.007, side * 0.272 + 0.007, {
        rise: 0.018,
        segZ: 12,
        segT: 1,
      }),
    );
    for (let i = 0; i < 5; i += 1) {
      const z = 5.2 + i * 0.34;
      const sample = surfaceAt(NOSE_BODY, z, side * 0.094);
      sample.position.addScaledVector(sample.normal, 0.034);
      placeBolt(trim, sample.position, sample.normal, 0.008);
    }
  }

  /* Dorsal and ventral fairing plates tie the module to the hull language. */
  trim.push(
    panelGeometry(NOSE_BODY, 5.15, 6.75, -0.06, 0.06, { rise: 0.02, segZ: 8, segT: 4 }),
  );
  trim.push(
    panelGeometry(NOSE_BODY, 5.2, 6.7, 0.44, 0.56, { rise: 0.02, segZ: 8, segT: 4 }),
  );

  /* Blade antennae and pitot probes. */
  for (const side of [1, -1]) {
    const sample = surfaceAt(NOSE_BODY, 5.22, side * 0.272);
    sample.position.addScaledVector(sample.normal, 0.02);
    trim.push(placeFlat(boxGeo(0.02, 0.13, 0.22), sample.position, sample.normal));
    const probe = surfaceAt(NOSE_BODY, 6.98, side * 0.3);
    probe.position.addScaledVector(probe.normal, 0.01);
    trim.push(placeAlong(cylinderGeo(0.006, 0.008, 0.2, 6), probe.position, new THREE.Vector3(0, 0, 1)));
  }

  /* Under nose radar altimeter and hazard tag. */
  const alt = surfaceAt(NOSE_BODY, 5.95, 0.55);
  alt.position.addScaledVector(alt.normal, 0.012);
  dark.push(placeFlat(boxGeo(0.2, 0.1, 0.05), alt.position, alt.normal));
  const tag = surfaceAt(NOSE_BODY, 5.3, 0.22);
  tag.position.addScaledVector(tag.normal, 0.03);
  accent.push(placeFlat(boxGeo(0.12, 0.035, 0.006), tag.position, tag.normal));

  return { body, trim, dark, ceramic, black, glass, accent, glowCyan, glowOrange };
}

function buildNoseStencils(): StencilPlacement[] {
  const array = makeDecalTexture(['AESA', '2048 ELEMENTS'], { width: 512, height: 256 });
  const step = makeDecalTexture(['NO STEP'], { width: 512, height: 192, align: 'center' });
  const hazard = makeDecalTexture(['HIGH POWER', 'RADAR'], {
    width: 512,
    height: 224,
    color: '#e8d6c2',
  });

  const at = (z: number, t: number, lift: number, width: number, height: number) => {
    const sample = surfaceAt(NOSE_BODY, z, t);
    return {
      position: vec(sample.position.clone().addScaledVector(sample.normal, lift)),
      normal: vec(sample.normal),
      width,
      height,
    };
  };

  const top = surfaceAt(NOSE_BODY, 5.75, 0.0);
  return [
    { key: 'nose-aesa', texture: array, ...at(5.1, 0.24, 0.03, 0.82, 0.4) },
    {
      key: 'nose-top',
      texture: step,
      position: vec(top.position.clone().addScaledVector(top.normal, 0.032)),
      normal: vec(top.normal),
      width: 0.62,
      height: 0.23,
      up: [0, 0, 1],
    },
    { key: 'nose-hazard', texture: hazard, ...at(7.0, -0.34, 0.02, 0.5, 0.24) },
  ];
}

export function NoseArray() {
  const materials = useShipMaterials();
  const built = useMemo(buildNose, []);
  const stencils = useMemo(buildNoseStencils, []);

  return (
    <group name="nose-sensor-array">
      <Merged geos={built.body} material={materials.dark} />
      <Merged geos={built.trim} material={materials.trim} />
      <Merged geos={built.dark} material={materials.dark} />
      <Merged geos={built.ceramic} material={materials.ceramic} />
      <Merged geos={built.black} material={materials.black} />
      <Merged geos={built.glass} material={materials.glass} cast={false} />
      <Merged geos={built.accent} material={materials.accent} />
      <Merged geos={built.glowCyan} material={materials.glowCyan} cast={false} receive={false} />
      <Merged geos={built.glowOrange} material={materials.glowOrange} cast={false} receive={false} />
      {stencils.map(({ key, ...rest }) => (
        <Stencil key={key} {...rest} />
      ))}
    </group>
  );
}
