import { useMemo } from 'react';
import * as THREE from 'three';
import { WEAPON_MUZZLES } from '../../../data/ship';
import { makeDecalTexture, useShipMaterials, type ShipMaterials } from '../materials';

/**
 * HELIOS-9 forward-swept lifting-body wings.
 *
 * All geometry is generated in assembled world coordinates for the starboard
 * side (+X) and mirrored analytically for the port side: x positions are
 * negated and triangle winding is reversed so normals stay outward. The
 * LANCE-7 pod muzzle is derived from WEAPON_MUZZLES so the laser FX layer and
 * the hardware can never drift apart.
 *
 * Local planform: root at x 1.15, tip at x 7.0. Leading edge sweeps forward
 * from z +0.55 at the root to z +1.01 mid-span then turns slightly aft for the
 * raked tip; the trailing edge sweeps hard forward (z -3.45 -> -0.10) which
 * clears the engine nacelles and gives the wing its aggressive forward-swept
 * read. Chord at the root is 4.0 m, 0.67 m at the tip.
 */

type MatKey = keyof ShipMaterials;

interface Piece {
  mat: MatKey;
  geo: THREE.BufferGeometry;
}

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/* ------------------------------------------------------------------ utils */

function centroid(points: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  points.forEach((point) => c.add(point));
  return c.multiplyScalar(1 / Math.max(1, points.length));
}

function flipWinding(geo: THREE.BufferGeometry): void {
  const index = geo.getIndex();
  if (!index) return;
  const array = index.array as Uint16Array | Uint32Array;
  for (let i = 0; i < array.length; i += 3) {
    const swap = array[i + 1];
    array[i + 1] = array[i + 2];
    array[i + 2] = swap;
  }
  index.needsUpdate = true;
}

interface LoftOptions {
  capStart?: boolean;
  capEnd?: boolean;
  uvRepeat?: number;
}

/**
 * Skin a list of equal-length rings into a closed lofted solid. Winding is
 * derived deterministically from the ring's projection onto the plane normal to
 * the spine: e1 x e2 = advance, so a positive projected area means the ring runs
 * counter-clockwise when seen from the far end of the loft.
 */
function loft(rings: THREE.Vector3[][], options: LoftOptions = {}): THREE.BufferGeometry {
  const stations = rings.length;
  const ringCount = rings[0].length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < stations; s += 1) {
    const ring = rings[s];
    for (let i = 0; i < ringCount; i += 1) {
      const p = ring[i];
      positions.push(p.x, p.y, p.z);
      uvs.push(i / ringCount, (s / Math.max(1, stations - 1)) * (options.uvRepeat ?? 1));
    }
  }

  // Spine direction and a right-handed in-plane basis with e1 x e2 = advance.
  const advance = centroid(rings[stations - 1]).sub(centroid(rings[0]));
  if (advance.lengthSq() < 1e-12) advance.set(0, 0, 1);
  advance.normalize();
  const helper = Math.abs(advance.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(helper, advance).normalize();
  const e2 = new THREE.Vector3().crossVectors(advance, e1).normalize();
  let projectedArea = 0;
  for (let i = 0; i < ringCount; i += 1) {
    const p = rings[0][i];
    const q = rings[0][(i + 1) % ringCount];
    projectedArea += p.dot(e1) * q.dot(e2) - q.dot(e1) * p.dot(e2);
  }
  const ringsCcw = projectedArea > 0;

  for (let s = 0; s < stations - 1; s += 1) {
    for (let i = 0; i < ringCount; i += 1) {
      const i2 = (i + 1) % ringCount;
      const a = s * ringCount + i;
      const b = s * ringCount + i2;
      const c = (s + 1) * ringCount + i2;
      const d = (s + 1) * ringCount + i;
      if (ringsCcw) indices.push(a, b, c, a, c, d);
      else indices.push(a, c, b, a, d, c);
    }
  }

  const addFan = (ringIndex: number, atStart: boolean) => {
    const ring = rings[ringIndex];
    const center = centroid(ring);
    const desired = atStart ? advance.clone().negate() : advance.clone();
    const fanNormal = ringsCcw ? advance.clone() : advance.clone().negate();
    const reverse = fanNormal.dot(desired) < 0;
    const centerVertex = positions.length / 3;
    positions.push(center.x, center.y, center.z);
    uvs.push(0.5, atStart ? 0 : 1);
    for (let i = 0; i < ringCount; i += 1) {
      const i2 = (i + 1) % ringCount;
      const a = ringIndex * ringCount + i;
      const b = ringIndex * ringCount + i2;
      if (reverse) indices.push(centerVertex, b, a);
      else indices.push(centerVertex, a, b);
    }
  };

  if (options.capStart) addFan(0, true);
  if (options.capEnd) addFan(stations - 1, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map((geo) => (geo.index ? geo.toNonIndexed() : geo));
  let vertexTotal = 0;
  flat.forEach((geo) => {
    vertexTotal += geo.getAttribute('position').count;
  });
  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  let offset = 0;
  flat.forEach((geo) => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    for (let i = 0; i < pos.count; i += 1) {
      const base = (offset + i) * 3;
      positions[base] = pos.getX(i);
      positions[base + 1] = pos.getY(i);
      positions[base + 2] = pos.getZ(i);
      if (nor) {
        normals[base] = nor.getX(i);
        normals[base + 1] = nor.getY(i);
        normals[base + 2] = nor.getZ(i);
      } else {
        normals[base + 1] = 1;
      }
      const uBase = (offset + i) * 2;
      if (uv) {
        uvs[uBase] = uv.getX(i);
        uvs[uBase + 1] = uv.getY(i);
      }
    }
    offset += pos.count;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeBoundingSphere();
  return geo;
}

function mergePieces(pieces: Piece[]): Array<{ mat: MatKey; geo: THREE.BufferGeometry }> {
  const groups = new Map<MatKey, THREE.BufferGeometry[]>();
  pieces.forEach(({ mat, geo }) => {
    const list = groups.get(mat);
    if (list) list.push(geo);
    else groups.set(mat, [geo]);
  });
  const merged: Array<{ mat: MatKey; geo: THREE.BufferGeometry }> = [];
  groups.forEach((geos, mat) => merged.push({ mat, geo: mergeNonIndexed(geos) }));
  return merged;
}

function mirrorX(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = source.clone();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i += 1) {
    pos.setX(i, -pos.getX(i));
    if (nor) nor.setX(i, -nor.getX(i));
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  const index = geo.getIndex();
  if (index) {
    const array = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < array.length; i += 3) {
      const swap = array[i + 1];
      array[i + 1] = array[i + 2];
      array[i + 2] = swap;
    }
    index.needsUpdate = true;
  } else {
    (['position', 'normal', 'uv'] as const).forEach((name) => {
      const attr = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!attr) return;
      const size = attr.itemSize;
      for (let t = 0; t < attr.count; t += 3) {
        for (let k = 0; k < size; k += 1) {
          const first = attr.getComponent(t + 1, k);
          attr.setComponent(t + 1, k, attr.getComponent(t + 2, k));
          attr.setComponent(t + 2, k, first);
        }
      }
      attr.needsUpdate = true;
    });
  }
  return geo;
}

function bake(
  geo: THREE.BufferGeometry,
  position: THREE.Vector3,
  direction?: THREE.Vector3,
  scale?: THREE.Vector3,
): THREE.BufferGeometry {
  const quat = new THREE.Quaternion();
  if (direction) quat.setFromUnitVectors(UP, direction.clone().normalize());
  const matrix = new THREE.Matrix4().compose(position, quat, scale ?? ONE);
  geo.applyMatrix4(matrix);
  return geo;
}

function bakeZ(geo: THREE.BufferGeometry, position: THREE.Vector3, axis: THREE.Vector3): THREE.BufferGeometry {
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    axis.clone().normalize(),
  );
  geo.applyMatrix4(new THREE.Matrix4().compose(position, quat, ONE));
  return geo;
}

function cylinderBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radiusA: number,
  radiusB: number = radiusA,
  segments = 10,
): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const length = dir.length();
  const geo = new THREE.CylinderGeometry(radiusB, radiusA, length, segments, 1, false);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  geo.applyMatrix4(new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), quat, ONE));
  return geo;
}

function boltGeo(
  position: THREE.Vector3,
  direction: THREE.Vector3,
  radius: number,
  height: number,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.15, height, 6, 1, false);
  return bake(geo, position, direction);
}

function tubeGeo(
  points: THREE.Vector3[],
  radius: number,
  tubularSegments = 26,
  radialSegments = 5,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
}

function decalGeometry(
  width: number,
  height: number,
  center: THREE.Vector3,
  normal: THREE.Vector3,
  up: THREE.Vector3,
): THREE.BufferGeometry {
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const fixedUp = new THREE.Vector3().crossVectors(normal, right).normalize();
  const geo = new THREE.PlaneGeometry(width, height);
  const basis = new THREE.Matrix4().makeBasis(right, fixedUp, normal.clone().normalize());
  const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
  geo.applyMatrix4(new THREE.Matrix4().compose(center, quat, ONE));
  return geo;
}

/* --------------------------------------------------- wing surface definition */

interface WingStation {
  x: number;
  le: number;
  te: number;
  y: number;
  t: number;
  camber: number;
}

const WING_STATIONS: readonly WingStation[] = [
  { x: 1.15, le: 0.55, te: -3.45, y: -0.15, t: 0.38, camber: 0.02 },
  { x: 1.55, le: 0.68, te: -3.21, y: -0.155, t: 0.36, camber: 0.022 },
  { x: 1.98, le: 0.79, te: -2.92, y: -0.16, t: 0.335, camber: 0.024 },
  { x: 2.42, le: 0.88, te: -2.6, y: -0.165, t: 0.305, camber: 0.024 },
  { x: 2.86, le: 0.94, te: -2.27, y: -0.168, t: 0.278, camber: 0.023 },
  { x: 3.3, le: 0.985, te: -1.99, y: -0.17, t: 0.252, camber: 0.022 },
  { x: 3.74, le: 1.005, te: -1.76, y: -0.168, t: 0.227, camber: 0.02 },
  { x: 4.18, le: 1.012, te: -1.55, y: -0.163, t: 0.203, camber: 0.018 },
  { x: 4.62, le: 1.005, te: -1.36, y: -0.155, t: 0.181, camber: 0.016 },
  { x: 5.04, le: 0.99, te: -1.2, y: -0.144, t: 0.162, camber: 0.014 },
  { x: 5.44, le: 0.972, te: -1.06, y: -0.132, t: 0.145, camber: 0.012 },
  { x: 5.82, le: 0.945, te: -0.94, y: -0.118, t: 0.13, camber: 0.01 },
  { x: 6.18, le: 0.91, te: -0.83, y: -0.104, t: 0.116, camber: 0.008 },
  { x: 6.5, le: 0.862, te: -0.72, y: -0.088, t: 0.103, camber: 0.006 },
  { x: 6.75, le: 0.8, te: -0.53, y: -0.072, t: 0.09, camber: 0.004 },
  { x: 6.9, le: 0.72, te: -0.36, y: -0.06, t: 0.08, camber: 0.003 },
  { x: 6.97, le: 0.64, te: -0.2, y: -0.054, t: 0.074, camber: 0.002 },
  { x: 7.0, le: 0.57, te: -0.09, y: -0.05, t: 0.07, camber: 0.001 },
];

/**
 * Normalised airfoil: [chord fraction 0 = LE, half-thickness fraction].
 * Upper surface is fuller than the lower one, trailing edge is slightly blunt,
 * which reads as a machined composite wing rather than a soft blob.
 */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.008, 0.24],
  [0.022, 0.44],
  [0.048, 0.64],
  [0.085, 0.8],
  [0.135, 0.915],
  [0.2, 0.985],
  [0.275, 1.0],
  [0.36, 0.975],
  [0.45, 0.915],
  [0.545, 0.835],
  [0.64, 0.735],
  [0.73, 0.62],
  [0.81, 0.5],
  [0.88, 0.38],
  [0.935, 0.265],
  [0.975, 0.16],
  [0.995, 0.07],
  [1.0, 0.01],
  [0.995, -0.05],
  [0.975, -0.1],
  [0.935, -0.16],
  [0.88, -0.235],
  [0.81, -0.305],
  [0.73, -0.36],
  [0.64, -0.405],
  [0.545, -0.44],
  [0.45, -0.46],
  [0.36, -0.45],
  [0.275, -0.415],
  [0.2, -0.36],
  [0.135, -0.285],
  [0.085, -0.205],
  [0.048, -0.135],
  [0.022, -0.075],
  [0.008, -0.035],
];

const TE_UPPER = 18;
const TE_LOWER = 19;

interface ProfileSample2D {
  point: THREE.Vector2;
  normal: THREE.Vector2;
}

function stationAt(x: number): WingStation {
  const first = WING_STATIONS[0];
  const last = WING_STATIONS[WING_STATIONS.length - 1];
  if (x <= first.x) return { ...first, x };
  if (x >= last.x) return { ...last, x };
  for (let i = 0; i < WING_STATIONS.length - 1; i += 1) {
    const a = WING_STATIONS[i];
    const b = WING_STATIONS[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return {
        x,
        le: THREE.MathUtils.lerp(a.le, b.le, t),
        te: THREE.MathUtils.lerp(a.te, b.te, t),
        y: THREE.MathUtils.lerp(a.y, b.y, t),
        t: THREE.MathUtils.lerp(a.t, b.t, t),
        camber: THREE.MathUtils.lerp(a.camber, b.camber, t),
      };
    }
  }
  return { ...last, x };
}

function stationProfile(st: WingStation): { points: THREE.Vector2[]; normals: THREE.Vector2[] } {
  const points = PROFILE.map(([u, h]) => {
    const z = st.le + (st.te - st.le) * u;
    const y = st.y + Math.sin(Math.PI * u) * st.camber + h * st.t * 0.5;
    return new THREE.Vector2(z, y);
  });
  const center = new THREE.Vector2((st.le + st.te) * 0.5, st.y + st.camber * 0.4);
  const normals = points.map((point, index) => {
    const prev = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const tangent = new THREE.Vector2(next.x - prev.x, next.y - prev.y);
    const normal = new THREE.Vector2(tangent.y, -tangent.x);
    if (normal.lengthSq() < 1e-12) normal.set(0, 1);
    normal.normalize();
    if (normal.dot(new THREE.Vector2(point.x - center.x, point.y - center.y)) < 0) normal.negate();
    return normal;
  });
  return { points, normals };
}

function wingRing(st: WingStation): THREE.Vector3[] {
  const { points } = stationProfile(st);
  return points.map((point) => new THREE.Vector3(st.x, point.y, point.x));
}

function stationsBetween(x0: number, x1: number, count: number): WingStation[] {
  const stations: WingStation[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    stations.push(stationAt(x0 + (x1 - x0) * t));
  }
  return stations;
}

function featherValue(t: number, amount: number): number {
  if (amount <= 0) return 1;
  const raw = Math.min(1, Math.min(t, 1 - t) / amount);
  return raw * raw * (3 - 2 * raw);
}

function surfaceSample(st: WingStation, u: number, side: 1 | -1): ProfileSample2D {
  const { points, normals } = stationProfile(st);
  let i0 = 0;
  let i1 = 1;
  if (side > 0) {
    for (let i = 0; i < TE_UPPER; i += 1) {
      if (u >= PROFILE[i][0] && u <= PROFILE[i + 1][0]) {
        i0 = i;
        i1 = i + 1;
        break;
      }
    }
  } else {
    for (let i = TE_LOWER; i < PROFILE.length - 1; i += 1) {
      if (u <= PROFILE[i][0] && u >= PROFILE[i + 1][0]) {
        i0 = i;
        i1 = i + 1;
        break;
      }
    }
  }
  const u0 = PROFILE[i0][0];
  const u1 = PROFILE[i1][0];
  const f = Math.abs(u1 - u0) < 1e-6 ? 0 : (u - u0) / (u1 - u0);
  const point = new THREE.Vector2(
    points[i0].x + (points[i1].x - points[i0].x) * f,
    points[i0].y + (points[i1].y - points[i0].y) * f,
  );
  const normal = new THREE.Vector2(
    normals[i0].x + (normals[i1].x - normals[i0].x) * f,
    normals[i0].y + (normals[i1].y - normals[i0].y) * f,
  ).normalize();
  return { point, normal };
}

function surfacePoint(x: number, u: number, side: 1 | -1, offset = 0): THREE.Vector3 {
  const st = stationAt(x);
  const sample = surfaceSample(st, u, side);
  return new THREE.Vector3(
    st.x,
    sample.point.y + sample.normal.y * offset,
    sample.point.x + sample.normal.x * offset,
  );
}

function surfaceNormal(x: number, u: number, side: 1 | -1): THREE.Vector3 {
  const st = stationAt(x);
  const sample = surfaceSample(st, u, side);
  return new THREE.Vector3(0, sample.normal.y, sample.normal.x).normalize();
}

/** Shell of thickness between two surface offsets, following a list of profile indices. */
function shellRings(
  stations: WingStation[],
  indexSeq: number[],
  offsetOuter: number,
  offsetInner: number,
  featherAmount = 0.16,
): THREE.Vector3[][] {
  const count = stations.length;
  return stations.map((st, stationIndex) => {
    const { points, normals } = stationProfile(st);
    const t = count === 1 ? 0.5 : stationIndex / (count - 1);
    const f = featherValue(t, featherAmount);
    const outerOffset = offsetInner + Math.max(0.0006, (offsetOuter - offsetInner) * f);
    const ring: THREE.Vector3[] = [];
    indexSeq.forEach((index) => {
      const point = points[index];
      const normal = normals[index];
      ring.push(
        new THREE.Vector3(
          st.x,
          point.y + normal.y * outerOffset,
          point.x + normal.x * outerOffset,
        ),
      );
    });
    [...indexSeq].reverse().forEach((index) => {
      const point = points[index];
      const normal = normals[index];
      ring.push(
        new THREE.Vector3(
          st.x,
          point.y + normal.y * offsetInner,
          point.x + normal.x * offsetInner,
        ),
      );
    });
    return ring;
  });
}

/* ------------------------------------------------------------- sub builders */

function ridgeGeometry(
  x0: number,
  x1: number,
  u: number,
  width: number,
  height: number,
  offset: number,
  side: 1 | -1,
  samples = 9,
  feather = 0.2,
): THREE.BufferGeometry {
  const rings: THREE.Vector3[][] = [];
  const segments = 12;
  for (let i = 0; i < samples; i += 1) {
    const t = samples === 1 ? 0.5 : i / (samples - 1);
    const x = x0 + (x1 - x0) * t;
    const st = stationAt(x);
    const sample = surfaceSample(st, u, side);
    const center = new THREE.Vector3(
      st.x,
      sample.point.y + sample.normal.y * offset,
      sample.point.x + sample.normal.x * offset,
    );
    const tangent = new THREE.Vector3(0, -sample.normal.x, sample.normal.y).normalize();
    const normal = new THREE.Vector3(0, sample.normal.y, sample.normal.x).normalize();
    const scale = 0.2 + 0.8 * featherValue(t, feather);
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < segments; k += 1) {
      const angle = (k / segments) * Math.PI * 2;
      ring.push(
        center
          .clone()
          .addScaledVector(tangent, Math.cos(angle) * width * 0.5 * scale)
          .addScaledVector(normal, Math.sin(angle) * height * 0.5 * scale),
      );
    }
    rings.push(ring);
  }
  return loft(rings, { capStart: true, capEnd: true, uvRepeat: 2 });
}

const ELEV_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.02, 0.35],
  [0.07, 0.7],
  [0.16, 0.95],
  [0.3, 1.0],
  [0.48, 0.9],
  [0.66, 0.7],
  [0.82, 0.45],
  [0.94, 0.2],
  [1.0, 0.0],
  [0.94, -0.17],
  [0.82, -0.35],
  [0.66, -0.5],
  [0.48, -0.6],
  [0.3, -0.62],
  [0.16, -0.55],
  [0.07, -0.35],
  [0.02, -0.12],
];

interface ElevonSpec {
  x0: number;
  x1: number;
  chord: number;
  thickness: number;
  deflection: number;
}

const ELEVONS: readonly ElevonSpec[] = [
  { x0: 4.05, x1: 5.25, chord: 0.52, thickness: 0.055, deflection: 7 * DEG },
  { x0: 5.4, x1: 6.6, chord: 0.42, thickness: 0.045, deflection: -4.5 * DEG },
];

function elevonFrame(x: number, spec: ElevonSpec) {
  const st = stationAt(x);
  const hinge = new THREE.Vector2(st.te - 0.035, st.y);
  const chordDir = new THREE.Vector2(-Math.cos(spec.deflection), Math.sin(spec.deflection));
  const normalDir = new THREE.Vector2(Math.sin(spec.deflection), Math.cos(spec.deflection));
  return { st, hinge, chordDir, normalDir };
}

function elevonPoint(x: number, spec: ElevonSpec, u: number, h: number, thicknessScale = 1): THREE.Vector3 {
  const { st, hinge, chordDir, normalDir } = elevonFrame(x, spec);
  return new THREE.Vector3(
    st.x,
    hinge.y + chordDir.y * u * spec.chord + normalDir.y * h * spec.thickness * thicknessScale,
    hinge.x + chordDir.x * u * spec.chord + normalDir.x * h * spec.thickness * thicknessScale,
  );
}

function buildElevon(spec: ElevonSpec, pieces: Piece[]): void {
  const stations = stationsBetween(spec.x0, spec.x1, 6);
  const rings = stations.map((st) => {
    const { hinge, chordDir, normalDir } = elevonFrame(st.x, spec);
    const taper = 0.72 + 0.28 * Math.sin(Math.PI * (st.x - spec.x0) / (spec.x1 - spec.x0));
    return ELEV_PROFILE.map(([u, h]) => {
      const z = hinge.x + chordDir.x * u * spec.chord + normalDir.x * h * spec.thickness * taper;
      const y = hinge.y + chordDir.y * u * spec.chord + normalDir.y * h * spec.thickness * taper;
      return new THREE.Vector3(st.x, y, z);
    });
  });
  pieces.push({ mat: 'hull', geo: loft(rings, { capStart: true, capEnd: true, uvRepeat: 3 }) });

  // Hinge hardware: a dark torque rod in the gap plus three machined knuckles.
  const st0 = stationAt(spec.x0);
  const st1 = stationAt(spec.x1);
  const axis = new THREE.Vector3(spec.x1 - spec.x0, 0, st1.te - st0.te).normalize();
  const hingeStart = new THREE.Vector3(spec.x0 + 0.05, st0.y, st0.te - 0.035);
  const hingeEnd = new THREE.Vector3(spec.x1 - 0.05, st1.y, st1.te - 0.035);
  pieces.push({
    mat: 'dark',
    geo: cylinderBetween(
      hingeStart.clone().addScaledVector(axis, -0.04),
      hingeEnd.clone().addScaledVector(axis, 0.04),
      0.019,
      0.019,
      10,
    ),
  });
  [0.2, 0.5, 0.8].forEach((t) => {
    const point = hingeStart.clone().lerp(hingeEnd, t);
    pieces.push({
      mat: 'trim',
      geo: cylinderBetween(
        point.clone().addScaledVector(axis, -0.05),
        point.clone().addScaledVector(axis, 0.05),
        0.032,
        0.032,
        10,
      ),
    });
    pieces.push({
      mat: 'dark',
      geo: boltGeo(point.clone().addScaledVector(axis, 0.052), axis, 0.014, 0.014),
    });
  });

  // Two hydraulic actuators per surface: streamlined fairing, housing, pushrod,
  // elevon horn. Actuator x stations are biased inboard of each surface.
  [0.3, 0.72].forEach((t) => {
    const x = spec.x0 + (spec.x1 - spec.x0) * t;
    const st = stationAt(x);
    const sample = surfaceSample(st, 0.84, 1);
    const fairingCenter = new THREE.Vector3(
      st.x,
      sample.point.y + sample.normal.y * 0.05,
      sample.point.x + sample.normal.x * 0.05,
    );
    pieces.push({
      mat: 'hull',
      geo: ridgeGeometry(x - 0.16, x + 0.16, 0.84, 0.2, 0.13, 0.03, 1, 5, 0.3),
    });
    const horn = elevonPoint(x, spec, 0.3, 0.9, 1);
    const housingEnd = fairingCenter.clone().lerp(horn, 0.42);
    pieces.push({ mat: 'trim', geo: cylinderBetween(fairingCenter, housingEnd, 0.032, 0.03, 10) });
    pieces.push({ mat: 'black', geo: cylinderBetween(housingEnd, horn, 0.017, 0.017, 8) });
    pieces.push({
      mat: 'trim',
      geo: bake(new THREE.BoxGeometry(0.07, 0.016, 0.11), horn.clone(), UP),
    });
    // Hydraulic feed line on the wing upper surface behind the fairing.
    const feed = surfacePoint(x - 0.35, 0.8, 1, 0.035);
    pieces.push({ mat: 'rubber', geo: cylinderBetween(feed, fairingCenter, 0.014, 0.014, 6) });
  });
}

function buildRcsCluster(position: THREE.Vector3, normal: THREE.Vector3, pieces: Piece[]): void {
  const housing = new THREE.CylinderGeometry(0.07, 0.085, 0.07, 10, 1, false);
  pieces.push({ mat: 'trim', geo: bake(housing, position.clone().addScaledVector(normal, 0.02), normal) });
  // Stable surface tangent: pick the world axis least aligned with the normal.
  const seed = Math.abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(seed, normal).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  [-1, 1].forEach((dir) => {
    const nozzlePos = position
      .clone()
      .addScaledVector(normal, 0.045)
      .addScaledVector(tangent, dir * 0.085);
    const nozzle = new THREE.CylinderGeometry(0.028, 0.042, 0.06, 8, 1, true);
    pieces.push({ mat: 'black', geo: bake(nozzle, nozzlePos, normal) });
    const lip = new THREE.TorusGeometry(0.038, 0.008, 5, 10);
    pieces.push({ mat: 'ceramic', geo: bakeZ(lip, nozzlePos.clone().addScaledVector(normal, 0.028), normal) });
    const glow = new THREE.CircleGeometry(0.02, 10);
    const basis = new THREE.Matrix4().makeBasis(tangent, bitangent, normal);
    glow.applyMatrix4(
      new THREE.Matrix4().compose(
        nozzlePos.clone().addScaledVector(normal, -0.02),
        new THREE.Quaternion().setFromRotationMatrix(basis),
        ONE,
      ),
    );
    pieces.push({ mat: 'glowCyan', geo: glow });
  });
}

function buildHardpoint(x: number, z: number, pieces: Piece[]): void {
  const st = stationAt(x);
  const u = THREE.MathUtils.clamp((z - st.le) / (st.te - st.le), 0.3, 0.8);
  const sample = surfaceSample(st, u, -1);
  const normal = new THREE.Vector3(0, sample.normal.y, sample.normal.x).normalize();
  const center = new THREE.Vector3(
    st.x,
    sample.point.y + sample.normal.y * 0.02,
    sample.point.x + sample.normal.x * 0.02,
  );
  const span = new THREE.Vector3(1, 0, 0);
  const chord = new THREE.Vector3().crossVectors(span, normal).normalize();
  const ring = (scale: number, drop: number) => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const sx = Math.sign(Math.cos(angle)) * Math.pow(Math.abs(Math.cos(angle)), 0.6);
      const sz = Math.sign(Math.sin(angle)) * Math.pow(Math.abs(Math.sin(angle)), 0.6);
      points.push(
        center
          .clone()
          .addScaledVector(normal, -drop)
          .addScaledVector(span, sx * 0.1 * scale)
          .addScaledVector(chord, sz * 0.2 * scale),
      );
    }
    return points;
  };
  const rings = [ring(1.0, 0), ring(0.94, 0.06), ring(0.72, 0.16)];
  pieces.push({ mat: 'hull', geo: loft(rings, { capStart: false, capEnd: true, uvRepeat: 2 }) });
  const foot = center.clone().addScaledVector(normal, -0.17);
  const plate = new THREE.CylinderGeometry(0.11, 0.11, 0.025, 10, 1, false);
  pieces.push({ mat: 'dark', geo: bake(plate, foot.clone().addScaledVector(normal, 0.012), normal) });
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    const offset = new THREE.Vector3(
      Math.cos(angle) * 0.1 * 0.75 + 0,
      Math.sin(angle) * 0.2 * 0.75,
      0,
    );
    pieces.push({
      mat: 'trim',
      geo: boltGeo(
        foot
          .clone()
          .addScaledVector(normal, -0.006)
          .addScaledVector(span, offset.x)
          .addScaledVector(chord, offset.y),
        normal,
        0.015,
        0.02,
      ),
    });
  }
  const connector = new THREE.CylinderGeometry(0.035, 0.045, 0.07, 8, 1, false);
  pieces.push({
    mat: 'trim',
    geo: bake(
      connector,
      center.clone().addScaledVector(normal, -0.16).addScaledVector(chord, 0.14),
      chord,
    ),
  });
  // Sway brace fairing on the outboard side of the pylon.
  pieces.push({
    mat: 'trim',
    geo: bake(new THREE.BoxGeometry(0.03, 0.11, 0.22), center.clone().addScaledVector(span, 0.11).addScaledVector(normal, -0.1), chord),
  });
}

/* ------------------------------------------------------------- main builder */

const MUZZLE = WEAPON_MUZZLES[1];
const POD_X = MUZZLE[0];
const POD_Y = MUZZLE[1];
const MUZZLE_Z = MUZZLE[2];

const POD_STATIONS: ReadonlyArray<Readonly<{ dz: number; rx: number; ry: number; flute: number }>> = [
  { dz: -2.4, rx: 0.038, ry: 0.038, flute: 0 },
  { dz: -2.3, rx: 0.075, ry: 0.078, flute: 0 },
  { dz: -2.15, rx: 0.115, ry: 0.12, flute: 0 },
  { dz: -1.97, rx: 0.152, ry: 0.16, flute: 0.01 },
  { dz: -1.77, rx: 0.18, ry: 0.19, flute: 0.015 },
  { dz: -1.55, rx: 0.198, ry: 0.21, flute: 0.02 },
  { dz: -1.33, rx: 0.206, ry: 0.218, flute: 0.025 },
  { dz: -1.13, rx: 0.21, ry: 0.222, flute: 0.03 },
  { dz: -0.99, rx: 0.21, ry: 0.222, flute: 0.03 },
  { dz: -0.89, rx: 0.206, ry: 0.218, flute: 0.03 },
  { dz: -0.83, rx: 0.16, ry: 0.17, flute: 0.02 },
  { dz: -0.69, rx: 0.1, ry: 0.105, flute: 0.05 },
  { dz: -0.51, rx: 0.094, ry: 0.098, flute: 0.06 },
  { dz: -0.35, rx: 0.094, ry: 0.098, flute: 0.06 },
  { dz: -0.25, rx: 0.106, ry: 0.11, flute: 0.04 },
  { dz: -0.17, rx: 0.12, ry: 0.124, flute: 0.02 },
  { dz: -0.07, rx: 0.133, ry: 0.137, flute: 0.01 },
  { dz: 0, rx: 0.138, ry: 0.142, flute: 0 },
];

function podRing(station: (typeof POD_STATIONS)[number]): THREE.Vector3[] {
  const ring: THREE.Vector3[] = [];
  const segments = 20;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const mod = 1 + station.flute * Math.cos(angle * 8);
    ring.push(
      new THREE.Vector3(
        POD_X + Math.cos(angle) * station.rx * mod,
        POD_Y + Math.sin(angle) * station.ry * mod,
        MUZZLE_Z + station.dz,
      ),
    );
  }
  return ring;
}

function podRadiusAtZ(z: number): number {
  const dz = z - MUZZLE_Z;
  if (dz >= POD_STATIONS[POD_STATIONS.length - 1].dz) return POD_STATIONS[POD_STATIONS.length - 1].rx;
  if (dz <= POD_STATIONS[0].dz) return POD_STATIONS[0].rx;
  for (let i = 0; i < POD_STATIONS.length - 1; i += 1) {
    const a = POD_STATIONS[i];
    const b = POD_STATIONS[i + 1];
    if (dz >= a.dz && dz <= b.dz) {
      const t = (dz - a.dz) / (b.dz - a.dz);
      return THREE.MathUtils.lerp(a.rx, b.rx, t);
    }
  }
  return POD_STATIONS[POD_STATIONS.length - 1].rx;
}

function buildCannonPod(pieces: Piece[]): void {
  // Conformal collar: a short bulge that blends the pod through the wing and
  // feathers back into the pod body at both ends, so the dark hull of the pod
  // and the barrel stay readable.
  const collarZ = [-0.85, -0.65, -0.42, -0.18, 0.08, 0.34, 0.58, 0.7];
  const collarScaleAt = (z: number) => {
    const t = (z - collarZ[0]) / (collarZ[collarZ.length - 1] - collarZ[0]);
    return 0.46 + 0.54 * Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1));
  };
  const collarRings: THREE.Vector3[][] = collarZ.map((z) => {
    const scale = collarScaleAt(z);
    const ring: THREE.Vector3[] = [];
    const segments = 16;
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      ring.push(
        new THREE.Vector3(
          POD_X + Math.cos(angle) * 0.305 * scale,
          POD_Y + Math.sin(angle) * 0.305 * scale,
          z,
        ),
      );
    }
    return ring;
  });
  pieces.push({ mat: 'hull', geo: loft(collarRings, { capStart: true, capEnd: true, uvRepeat: 2 }) });

  // Collar seam bands and mounting bolts.
  [-0.5, 0.1, 0.56].forEach((z) => {
    const radius = 0.305 * collarScaleAt(z) + 0.007;
    const band = new THREE.CylinderGeometry(radius, radius, 0.022, 20, 1, true);
    pieces.push({
      mat: 'trim',
      geo: bakeZ(band, new THREE.Vector3(POD_X, POD_Y, z), new THREE.Vector3(0, 0, 1)),
    });
  });
  [-1.6, -0.85, 0.85, 1.6].forEach((angleDeg) => {
    const angle = angleDeg * DEG;
    const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    const z = -0.18;
    const radius = 0.305 * collarScaleAt(z);
    pieces.push({
      mat: 'trim',
      geo: boltGeo(
        new THREE.Vector3(POD_X + dir.x * radius, POD_Y + dir.y * radius, z),
        dir,
        0.013,
        0.02,
      ),
    });
  });
  // Recessed vent slots on the collar shoulders.
  [-0.45, -0.3].forEach((z) => {
    const radius = 0.305 * collarScaleAt(z);
    [55, 125, 235, 305].forEach((angleDeg) => {
      const angle = angleDeg * DEG;
      const slot = new THREE.BoxGeometry(0.09, 0.024, 0.016);
      const pos = new THREE.Vector3(
        POD_X + Math.cos(angle) * (radius - 0.004),
        POD_Y + Math.sin(angle) * (radius - 0.004),
        z,
      );
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      slot.applyMatrix4(new THREE.Matrix4().compose(pos, quat, ONE));
      pieces.push({ mat: 'black', geo: slot });
    });
  });

  // Main pod body + barrel (open at the muzzle plane).
  pieces.push({
    mat: 'dark',
    geo: loft(POD_STATIONS.map(podRing), { capStart: true, capEnd: false, uvRepeat: 4 }),
  });

  // Muzzle ring face: the aperture is exactly at WEAPON_MUZZLES[1].
  const outerRing = podRing(POD_STATIONS[POD_STATIONS.length - 1]);
  const aperture = 0.085;
  const innerRing: THREE.Vector3[] = outerRing.map((point) => {
    const dx = point.x - POD_X;
    const dy = point.y - POD_Y;
    const len = Math.hypot(dx, dy);
    return new THREE.Vector3(POD_X + (dx / len) * aperture, POD_Y + (dy / len) * aperture, MUZZLE_Z);
  });
  const facePositions: number[] = [];
  const faceUvs: number[] = [];
  outerRing.forEach((point) => {
    facePositions.push(point.x, point.y, point.z);
    faceUvs.push(0.5 + (point.x - POD_X) / 0.4, 0.5 + (point.y - POD_Y) / 0.4);
  });
  innerRing.forEach((point) => {
    facePositions.push(point.x, point.y, point.z);
    faceUvs.push(0.5 + ((point.x - POD_X) / aperture) * 0.35, 0.5 + ((point.y - POD_Y) / aperture) * 0.35);
  });
  const faceIndices: number[] = [];
  const ringCount = outerRing.length;
  for (let i = 0; i < ringCount; i += 1) {
    const i2 = (i + 1) % ringCount;
    faceIndices.push(i, ringCount + i, ringCount + i2, i, ringCount + i2, i2);
  }
  const face = new THREE.BufferGeometry();
  face.setAttribute('position', new THREE.Float32BufferAttribute(facePositions, 3));
  face.setAttribute('uv', new THREE.Float32BufferAttribute(faceUvs, 2));
  face.setIndex(faceIndices);
  face.computeVertexNormals();
  const faceNormalAttribute = face.getAttribute('normal') as THREE.BufferAttribute;
  if (faceNormalAttribute.getZ(0) < 0) flipWinding(face);
  face.computeVertexNormals();
  pieces.push({ mat: 'trim', geo: face });

  // Muzzle lip ring. Kept behind the aperture plane so WEAPON_MUZZLES[1].z
  // remains the forward-most point of the hardware.
  const lip = new THREE.TorusGeometry(0.146, 0.012, 6, 22);
  pieces.push({ mat: 'ceramic', geo: bakeZ(lip, new THREE.Vector3(POD_X, POD_Y, MUZZLE_Z - 0.015), new THREE.Vector3(0, 0, 1)) });

  // Bore: inward-facing tube + glowing emitter deep inside.
  const bore: THREE.Vector3[][] = [0.0, -0.14, -0.3].map((dz) => {
    const radius = 0.085 + dz * 0.02;
    const ring: THREE.Vector3[] = [];
    const segments = 20;
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      ring.push(
        new THREE.Vector3(
          POD_X + Math.cos(angle) * radius,
          POD_Y + Math.sin(angle) * radius,
          MUZZLE_Z + dz,
        ),
      );
    }
    return ring;
  });
  const boreGeo = loft(bore, { capStart: false, capEnd: false });
  flipWinding(boreGeo);
  boreGeo.computeVertexNormals();
  pieces.push({ mat: 'black', geo: boreGeo });

  const emitterBack = new THREE.CircleGeometry(0.082, 18);
  pieces.push({
    mat: 'dark',
    geo: bakeZ(emitterBack, new THREE.Vector3(POD_X, POD_Y, MUZZLE_Z - 0.32), new THREE.Vector3(0, 0, 1)),
  });
  const emitter = new THREE.CircleGeometry(0.062, 18);
  pieces.push({
    mat: 'glowCyan',
    geo: bakeZ(emitter, new THREE.Vector3(POD_X, POD_Y, MUZZLE_Z - 0.3), new THREE.Vector3(0, 0, 1)),
  });
  const emitterRing = new THREE.TorusGeometry(0.078, 0.009, 5, 16);
  pieces.push({
    mat: 'trim',
    geo: bakeZ(emitterRing, new THREE.Vector3(POD_X, POD_Y, MUZZLE_Z - 0.29), new THREE.Vector3(0, 0, 1)),
  });

  // Barrel cooling collars (exposed section forward of the collar).
  [0.74, 0.82, 0.9, 0.98].forEach((z) => {
    const radius = podRadiusAtZ(z) + 0.022;
    const collar = new THREE.CylinderGeometry(radius, radius, 0.016, 16, 1, true);
    pieces.push({ mat: 'trim', geo: bakeZ(collar, new THREE.Vector3(POD_X, POD_Y, z), new THREE.Vector3(0, 0, 1)) });
  });

  // Muzzle-end radiator fins.
  [0, 120, 240].forEach((angleDeg) => {
    const angle = angleDeg * DEG;
    const blade = new THREE.BoxGeometry(0.012, 0.075, 0.22);
    const pos = new THREE.Vector3(
      POD_X + Math.cos(angle) * 0.175,
      POD_Y + Math.sin(angle) * 0.175,
      1.1,
    );
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    blade.applyMatrix4(new THREE.Matrix4().compose(pos, quat, ONE));
    pieces.push({ mat: 'trim', geo: blade });
  });

  // Hazard band just behind the muzzle ring.
  {
    const radius = podRadiusAtZ(1.14) + 0.013;
    const band = new THREE.CylinderGeometry(radius, radius, 0.026, 20, 1, true);
    pieces.push({ mat: 'accent', geo: bakeZ(band, new THREE.Vector3(POD_X, POD_Y, 1.14), new THREE.Vector3(0, 0, 1)) });
  }
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    pieces.push({
      mat: 'trim',
      geo: boltGeo(
        new THREE.Vector3(
          POD_X + Math.cos(angle) * 0.125,
          POD_Y + Math.sin(angle) * 0.125,
          MUZZLE_Z - 0.075,
        ),
        new THREE.Vector3(0, 0, 1),
        0.011,
        0.018,
      ),
    });
  }

  // Support struts from the wing underside into the pod shoulder.
  [4.95, 5.4, 5.85].forEach((x) => {
    const sample = surfaceSample(stationAt(x), 0.55, -1);
    const base = new THREE.Vector3(
      x,
      sample.point.y + sample.normal.y * 0.02,
      sample.point.x + sample.normal.x * 0.02,
    );
    const target = new THREE.Vector3(
      POD_X + Math.sign(x - POD_X) * 0.16,
      POD_Y - 0.2,
      -0.32,
    );
    pieces.push({ mat: 'trim', geo: cylinderBetween(base, target, 0.026, 0.018, 8) });
    pieces.push({
      mat: 'dark',
      geo: bake(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8), base, new THREE.Vector3(0, 1, 0)),
    });
  });
}

function buildWingPieces(): Piece[] {
  const pieces: Piece[] = [];

  /* --- primary lifting-body skin ---------------------------------------- */
  pieces.push({
    mat: 'hull',
    geo: loft(WING_STATIONS.map(wingRing), { capStart: true, capEnd: true, uvRepeat: 5 }),
  });

  /* --- blended root glove ------------------------------------------------ */
  const gloveFactors: Array<[number, number]> = [
    [1.04, 1.62],
    [1.14, 1.52],
    [1.27, 1.4],
    [1.42, 1.26],
    [1.54, 1.14],
    [1.64, 1.05],
  ];
  const gloveStations = gloveFactors.map(([x, factor]) => {
    const st = stationAt(x);
    return { ...st, x, t: st.t * factor, y: st.y - 0.012 };
  });
  pieces.push({
    mat: 'hull',
    geo: loft(gloveStations.map(wingRing), { capStart: true, capEnd: true, uvRepeat: 3 }),
  });
  pieces.push({
    mat: 'trim',
    geo: loft(
      shellRings(stationsBetween(1.6, 1.72, 5), PROFILE.map((_, i) => i), 0.016, 0.004, 0.3),
      { uvRepeat: 1 },
    ),
  });

  /* --- layered leading-edge armour -------------------------------------- */
  const leIndexSeq: number[] = [];
  for (let i = 6; i >= 0; i -= 1) leIndexSeq.push(i);
  for (let i = PROFILE.length - 1; i >= 30; i -= 1) leIndexSeq.push(i);

  const leSegments: Array<[number, number]> = [
    [1.2, 2.48],
    [2.56, 4.12],
    [4.2, 5.76],
    [5.84, 6.92],
  ];
  leSegments.forEach(([x0, x1]) => {
    pieces.push({
      mat: 'ceramic',
      geo: loft(shellRings(stationsBetween(x0 + 0.03, x1 - 0.03, 8), leIndexSeq, 0.03, 0.004, 0.14), {
        uvRepeat: 5,
      }),
    });
  });

  // Retaining bands at the armour seams.
  [2.52, 4.16, 5.8].forEach((xCenter) => {
    const stations = [-0.05, -0.025, 0, 0.025, 0.05].map((dx) => stationAt(xCenter + dx));
    pieces.push({
      mat: 'trim',
      geo: loft(shellRings(stations, leIndexSeq, 0.042, 0.021, 0.24), { uvRepeat: 1 }),
    });
    pieces.push({
      mat: 'trim',
      geo: loft(shellRings(stations, leIndexSeq, 0.05, 0.038, 0.24), { uvRepeat: 1 }),
    });
  });

  // A thin capping rail layered over the armour.
  pieces.push({
    mat: 'trim',
    geo: loft(
      shellRings(stationsBetween(1.22, 6.9, 16), [2, 1, 0, PROFILE.length - 1, PROFILE.length - 2], 0.044, 0.034, 0.03),
      { uvRepeat: 8 },
    ),
  });

  // Fasteners along the leading edge armour.
  for (let x = 1.5; x < 6.85; x += 0.46) {
    [0.1].forEach((u) => {
      const upperPoint = surfacePoint(x, u, 1, 0.032);
      pieces.push({
        mat: 'trim',
        geo: boltGeo(upperPoint, surfaceNormal(x, u, 1), 0.012, 0.018),
      });
      const lowerPoint = surfacePoint(x, u, -1, 0.032);
      pieces.push({
        mat: 'trim',
        geo: boltGeo(lowerPoint, surfaceNormal(x, u, -1), 0.012, 0.018),
      });
    });
  }

  /* --- upper / lower access panels -------------------------------------- */
  const panel = (
    x0: number,
    x1: number,
    indexSeq: number[],
    outer: number,
    mat: MatKey = 'hull',
    steps = 7,
    feather = 0.2,
  ) => {
    pieces.push({
      mat,
      geo: loft(shellRings(stationsBetween(x0, x1, steps), indexSeq, outer, 0.003, feather), { uvRepeat: 2 }),
    });
  };
  panel(2.12, 3.34, [7, 8, 9, 10, 11], 0.014);
  panel(3.46, 4.58, [8, 9, 10, 11, 12], 0.012);
  panel(5.94, 6.62, [7, 8, 9, 10], 0.012);
  panel(2.3, 3.9, [19, 20, 21, 22, 23], 0.012);
  panel(4.2, 5.2, [20, 21, 22], 0.01);

  // Raised chine strakes / seam rails.
  panel(1.9, 6.8, [9, 10], 0.024, 'trim', 12, 0.06);
  panel(2.6, 6.2, [26, 27], 0.02, 'trim', 10, 0.06);
  panel(2.4, 6.4, [11, 12], 0.0035, 'dark', 9, 0.08);
  panel(3.2, 6.2, [23, 24], 0.0035, 'dark', 9, 0.08);
  panel(2.0, 4.6, [13, 14], 0.0025, 'dark', 8, 0.1);

  // Fasteners around the access panels.
  [
    [2.25, 0.36],
    [3.2, 0.36],
    [3.6, 0.5],
    [4.45, 0.5],
    [6.05, 0.4],
    [6.5, 0.4],
  ].forEach(([x, u]) => {
    pieces.push({
      mat: 'trim',
      geo: boltGeo(surfacePoint(x, u, 1, 0.018), surfaceNormal(x, u, 1), 0.011, 0.016),
    });
  });

  /* --- fuel / actuator fairings ----------------------------------------- */
  pieces.push({ mat: 'hull', geo: ridgeGeometry(1.55, 4.15, 0.44, 0.52, 0.17, 0.018, 1, 11, 0.2) });
  pieces.push({ mat: 'hull', geo: ridgeGeometry(2.05, 3.55, 0.56, 0.28, 0.1, 0.016, -1, 8, 0.24) });
  pieces.push({ mat: 'hull', geo: ridgeGeometry(3.7, 5.42, 0.8, 0.36, 0.13, 0.016, -1, 9, 0.2) });

  // Ridge clamp bands and filler cap.
  [1.9, 2.7, 3.5].forEach((x) => {
    pieces.push({ mat: 'trim', geo: ridgeGeometry(x - 0.035, x + 0.035, 0.44, 0.545, 0.19, 0.018, 1, 4, 0) });
  });
  const fillerCenter = surfacePoint(2.35, 0.44, 1, 0.1);
  pieces.push({
    mat: 'dark',
    geo: bake(new THREE.CylinderGeometry(0.1, 0.1, 0.016, 12), fillerCenter, surfaceNormal(2.35, 0.44, 1)),
  });
  pieces.push({
    mat: 'trim',
    geo: bake(new THREE.CylinderGeometry(0.075, 0.085, 0.035, 6), fillerCenter.clone().addScaledVector(surfaceNormal(2.35, 0.44, 1), 0.018), surfaceNormal(2.35, 0.44, 1)),
  });

  /* --- control surfaces -------------------------------------------------- */
  ELEVONS.forEach((spec) => buildElevon(spec, pieces));

  /* --- root attachment hardware ----------------------------------------- */
  // Fittings sit just outboard of the root glove so the wing-to-frame
  // connection stays exposed.
  const rootSt = stationAt(1.86);
  [0.27, 0.45, 0.63, 0.81].forEach((u) => {
    const sample = surfaceSample(rootSt, u, 1);
    const normal = new THREE.Vector3(0, sample.normal.y, sample.normal.x).normalize();
    const base = new THREE.Vector3(
      rootSt.x,
      sample.point.y + normal.y * 0.024,
      sample.point.x + normal.x * 0.024,
    );
    const span = new THREE.Vector3(1, 0, 0);
    const chord = new THREE.Vector3().crossVectors(span, normal).normalize();
    const lugRings: THREE.Vector3[][] = [];
    [-0.075, -0.05, 0.05, 0.075].forEach((dx) => {
      const scale = 1 - Math.abs(dx) * 2.6;
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k < 10; k += 1) {
        const angle = (k / 10) * Math.PI * 2;
        ring.push(
          base
            .clone()
            .addScaledVector(span, dx)
            .addScaledVector(chord, Math.cos(angle) * 0.075 * scale)
            .addScaledVector(normal, Math.sin(angle) * 0.055 * scale + 0.012),
        );
      }
      lugRings.push(ring);
    });
    pieces.push({ mat: 'trim', geo: loft(lugRings, { capStart: true, capEnd: true, uvRepeat: 1 }) });
    pieces.push({
      mat: 'dark',
      geo: cylinderBetween(
        base.clone().addScaledVector(chord, -0.11).addScaledVector(normal, 0.052),
        base.clone().addScaledVector(chord, 0.11).addScaledVector(normal, 0.052),
        0.018,
        0.018,
        8,
      ),
    });
    [-1, 1].forEach((direction) => {
      pieces.push({
        mat: 'trim',
        geo: boltGeo(
          base.clone().addScaledVector(chord, direction * 0.05).addScaledVector(normal, 0.075),
          normal,
          0.014,
          0.021,
        ),
      });
    });
  });

  // Chordwise reinforcement ribs at the wing root, upper and lower.
  panel(1.72, 1.8, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], 0.02, 'trim', 3, 0.26);
  panel(1.72, 1.8, [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34], 0.02, 'trim', 3, 0.26);

  // Root bolt ring where the wing bolts to the hull frame.
  for (let i = 0; i < 10; i += 1) {
    const u = 0.24 + i * 0.075;
    pieces.push({
      mat: 'trim',
      geo: boltGeo(surfacePoint(1.78, u, 1, 0.02), surfaceNormal(1.78, u, 1), 0.013, 0.018),
    });
  }

  // Root hydraulic actuator with its own feed lines.
  const actuatorA = surfacePoint(1.95, 0.4, 1, 0.07);
  const actuatorB = surfacePoint(2.7, 0.48, 1, 0.055);
  const actuatorMid = actuatorA.clone().lerp(actuatorB, 0.55);
  pieces.push({ mat: 'trim', geo: cylinderBetween(actuatorA, actuatorMid, 0.052, 0.045, 12) });
  pieces.push({ mat: 'black', geo: cylinderBetween(actuatorMid, actuatorB, 0.024, 0.02, 8) });
  pieces.push({
    mat: 'trim',
    geo: bake(new THREE.BoxGeometry(0.09, 0.03, 0.14), actuatorA.clone(), UP),
  });
  pieces.push({
    mat: 'rubber',
    geo: tubeGeo(
      [
        surfacePoint(1.4, 0.35, -1, 0.05),
        surfacePoint(1.9, 0.42, -1, 0.06),
        surfacePoint(2.4, 0.5, -1, 0.07),
        surfacePoint(2.9, 0.62, -1, 0.06),
      ],
      0.016,
      18,
      5,
    ),
  });

  /* --- under-wing hardpoints -------------------------------------------- */
  buildHardpoint(4.15, -0.35, pieces);
  buildHardpoint(4.85, -0.2, pieces);

  /* --- louvered heat-exchanger vents ------------------------------------ */
  const vent = (x0: number, x1: number, indexSeq: number[], side: 1 | -1) => {
    pieces.push({
      mat: 'black',
      geo: loft(shellRings(stationsBetween(x0, x1, 6), indexSeq, 0.006, 0.001, 0.1), { uvRepeat: 1 }),
    });
    const us = indexSeq.map((i) => PROFILE[i][0]);
    const uMid = (us[0] + us[us.length - 1]) * 0.5;
    const st = stationAt((x0 + x1) * 0.5);
    const sample = surfaceSample(st, uMid, side);
    const normal = new THREE.Vector3(0, sample.normal.y, sample.normal.x).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, normal);
    const slats = 6;
    for (let i = 0; i < slats; i += 1) {
      const t = (i + 0.5) / slats;
      const x = THREE.MathUtils.lerp(x0, x1, t);
      const slat = new THREE.BoxGeometry(((x1 - x0) / slats) * 0.72, 0.014, 0.045);
      slat.applyMatrix4(
        new THREE.Matrix4().compose(surfacePoint(x, uMid, side, 0.022), quat, ONE),
      );
      pieces.push({ mat: 'trim', geo: slat });
    }
  };
  vent(2.2, 2.95, [12, 13, 14, 15, 16], 1);
  vent(4.3, 5.1, [21, 22, 23, 24, 25], -1);

  /* --- trailing-edge static dischargers --------------------------------- */
  [3.2, 4.25, 5.65, 6.55].forEach((x) => {
    const st = stationAt(x);
    const tip = new THREE.Vector3(x, st.y - 0.01, st.te + 0.01);
    const end = tip.clone().add(new THREE.Vector3(0, -0.05, -0.16));
    pieces.push({ mat: 'black', geo: cylinderBetween(tip, end, 0.012, 0.002, 6) });
  });

  /* --- LANCE-7 particle cannon pod -------------------------------------- */
  buildCannonPod(pieces);

  /* --- wingtip hardware -------------------------------------------------- */
  const tipOuter = stationAt(6.97);
  const tipLast = stationAt(7.0);
  pieces.push({
    mat: 'ceramic',
    geo: loft(
      [
        wingRing(tipOuter).map((point) => new THREE.Vector3(point.x, point.y - 0.05, point.z - 0.09)),
        wingRing(tipLast),
      ],
      { capStart: true, capEnd: true, uvRepeat: 1 },
    ),
  });
  // Formation light.
  const lightPos = surfacePoint(6.88, 0.3, 1, 0.012);
  const lightNormal = surfaceNormal(6.88, 0.3, 1);
  pieces.push({ mat: 'glowCyan', geo: bake(new THREE.SphereGeometry(0.035, 10, 8), lightPos, lightNormal) });
  pieces.push({
    mat: 'trim',
    geo: bakeZ(new THREE.TorusGeometry(0.042, 0.009, 5, 12), lightPos.clone().addScaledVector(lightNormal, 0.004), lightNormal),
  });
  // Wingtip RCS block.
  const rcsPos = surfacePoint(6.6, 0.42, 1, 0.015);
  buildRcsCluster(rcsPos, surfaceNormal(6.6, 0.42, 1), pieces);
  // Blade antenna at the tip trailing edge.
  const blade = new THREE.BoxGeometry(0.014, 0.36, 0.11);
  blade.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(6.79, 0.2, -0.34),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, 0, 0)),
      ONE,
    ),
  );
  pieces.push({ mat: 'trim', geo: blade });
  pieces.push({
    mat: 'dark',
    geo: bake(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 8), new THREE.Vector3(6.78, 0.01, -0.17), UP),
  });
  // Heat-exchanger grille near the tip trailing edge.
  for (let i = 0; i < 4; i += 1) {
    const z = -0.12 - i * 0.045;
    pieces.push({
      mat: 'black',
      geo: bake(new THREE.BoxGeometry(0.32, 0.012, 0.024), new THREE.Vector3(6.55, -0.01, z), UP),
    });
  }

  return pieces;
}

/* --------------------------------------------------------------- decals */

interface DecalPart {
  geo: THREE.BufferGeometry;
  material: THREE.Material;
}

function buildWingDecals(side: 'L' | 'R'): DecalPart[] {
  const sign = side === 'R' ? 1 : -1;
  const parts: DecalPart[] = [];
  const makeMaterial = (texture: THREE.Texture) =>
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });

  const stencilTexture = makeDecalTexture(['AX-09', 'HELIOS'], {
    width: 512,
    height: 256,
    color: '#ccd8dc',
    accent: '#5fe7f2',
    align: 'left',
  });
  const stepTexture = makeDecalTexture(['NO STEP'], {
    width: 512,
    height: 160,
    color: '#c4cfd3',
    accent: '#5fe7f2',
    align: 'center',
  });
  const podTexture = makeDecalTexture(['LANCE-7', 'PARTICLE CANNON'], {
    width: 512,
    height: 256,
    color: '#d3dde0',
    accent: '#ff8a3d',
    align: 'left',
  });

  // Wing upper surface stencil.
  {
    const x = 2.5;
    const sample = surfaceSample(stationAt(x), 0.55, 1);
    const center = new THREE.Vector3(
      sign * x,
      sample.point.y + sample.normal.y * 0.016,
      sample.point.x + sample.normal.x * 0.016,
    );
    const normal = new THREE.Vector3(0, sample.normal.y, sample.normal.x).normalize();
    parts.push({
      geo: decalGeometry(0.86, 0.26, center, normal, new THREE.Vector3(0, 0, -1)),
      material: makeMaterial(stencilTexture),
    });
  }

  // Wingtip NO STEP placard.
  {
    const x = 6.28;
    const sample = surfaceSample(stationAt(x), 0.42, 1);
    const center = new THREE.Vector3(
      sign * x,
      sample.point.y + sample.normal.y * 0.016,
      sample.point.x + sample.normal.x * 0.016,
    );
    const normal = new THREE.Vector3(0, sample.normal.y, sample.normal.x).normalize();
    parts.push({
      geo: decalGeometry(0.5, 0.13, center, normal, new THREE.Vector3(0, 0, -1)),
      material: makeMaterial(stepTexture),
    });
  }

  // Cannon pod fairing stencil, on the exposed outboard shoulder.
  {
    const center = new THREE.Vector3(sign * (POD_X + 0.312), POD_Y, MUZZLE_Z - 1.55);
    const normal = new THREE.Vector3(sign, 0, 0);
    parts.push({
      geo: decalGeometry(0.34, 0.1, center, normal, new THREE.Vector3(0, 1, 0)),
      material: makeMaterial(podTexture),
    });
  }

  return parts;
}

/* ------------------------------------------------------------- component */

const wingGeometryCache = new Map<'L' | 'R', Array<{ mat: MatKey; geo: THREE.BufferGeometry }>>();
let starboardPieces: Piece[] | null = null;

function wingGeometries(side: 'L' | 'R') {
  const cached = wingGeometryCache.get(side);
  if (cached) return cached;
  if (!starboardPieces) starboardPieces = buildWingPieces();
  const pieces =
    side === 'L'
      ? starboardPieces.map((piece) => ({ mat: piece.mat, geo: mirrorX(piece.geo) }))
      : starboardPieces;
  const merged = mergePieces(pieces);
  wingGeometryCache.set(side, merged);
  return merged;
}

function WingDecals({ side }: { side: 'L' | 'R' }) {
  const parts = useMemo(() => buildWingDecals(side), [side]);
  return (
    <>
      {parts.map((part, index) => (
        <mesh key={`decal-${index}`} geometry={part.geo} material={part.material} renderOrder={3} />
      ))}
    </>
  );
}

export function Wing({ side }: { side: 'L' | 'R' }) {
  const materials = useShipMaterials();
  const meshes = useMemo(() => wingGeometries(side), [side]);
  return (
    <group name={`wing-${side.toLowerCase()}`}>
      {meshes.map(({ mat, geo }) => (
        <mesh key={mat} geometry={geo} material={materials[mat]} castShadow receiveShadow />
      ))}
      <WingDecals side={side} />
    </group>
  );
}

/* --------------------------------------------------------- introspection */

export interface WingInspection {
  side: 'L' | 'R';
  triangles: number;
  meshes: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  muzzle: { x: number; y: number; z: number; axis: [number, number, number]; matchesData: boolean };
}

function geometryVolume(geo: THREE.BufferGeometry): number {
  const position = geo.getAttribute('position') as THREE.BufferAttribute;
  const index = geo.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const count = index ? index.count : position.count;
  let volume = 0;
  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    volume += a.dot(cross.crossVectors(b, c));
  }
  return volume / 6;
}

export interface WingPieceDiagnostics {
  pieces: number;
  triangles: number;
  negativePieces: Array<{
    mat: MatKey;
    volume: number;
    triangles: number;
    center: [number, number, number];
  }>;
  nearZeroPieces: number;
}

/** Build-time sanity data: every closed shell should have a positive signed volume. */
export function wingPieceDiagnostics(): WingPieceDiagnostics {
  if (!starboardPieces) starboardPieces = buildWingPieces();
  let triangles = 0;
  let nearZeroPieces = 0;
  const negativePieces: WingPieceDiagnostics['negativePieces'] = [];
  starboardPieces.forEach(({ mat, geo }) => {
    const pieceTriangles = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
    triangles += pieceTriangles;
    const volume = geometryVolume(geo);
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (volume < -1e-8) {
      negativePieces.push({
        mat,
        volume: Number(volume.toFixed(6)),
        triangles: Math.round(pieceTriangles),
        center: box
          ? [
              Number(((box.min.x + box.max.x) / 2).toFixed(3)),
              Number(((box.min.y + box.max.y) / 2).toFixed(3)),
              Number(((box.min.z + box.max.z) / 2).toFixed(3)),
            ]
          : [0, 0, 0],
      });
    } else if (Math.abs(volume) < 1e-8) {
      nearZeroPieces += 1;
    }
  });
  return {
    pieces: starboardPieces.length,
    triangles: Math.round(triangles),
    negativePieces,
    nearZeroPieces,
  };
}

/** Raw merged geometry, exposed for offline/QA inspection. */
export function wingMeshGeometries(side: 'L' | 'R' = 'R'): THREE.BufferGeometry[] {
  return wingGeometries(side).map((entry) => entry.geo);
}

export function inspectWing(side: 'L' | 'R' = 'R'): WingInspection {
  const meshes = wingGeometries(side);
  let triangles = 0;
  const box = new THREE.Box3();
  meshes.forEach(({ geo }) => {
    triangles += geo.getAttribute('position').count / 3;
    geo.computeBoundingBox();
    if (geo.boundingBox) box.union(geo.boundingBox);
  });
  const target = WEAPON_MUZZLES[side === 'R' ? 1 : 0];
  const reportedX = side === 'R' ? POD_X : -POD_X;
  return {
    side,
    triangles: Math.round(triangles),
    meshes: meshes.length,
    bounds: {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    },
    muzzle: {
      x: reportedX,
      y: POD_Y,
      z: MUZZLE_Z,
      axis: [0, 0, 1],
      matchesData:
        Math.abs(reportedX - target[0]) < 1e-6 &&
        Math.abs(POD_Y - target[1]) < 1e-6 &&
        Math.abs(MUZZLE_Z - target[2]) < 1e-6,
    },
  };
}
