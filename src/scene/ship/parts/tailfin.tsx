import { useMemo } from 'react';
import * as THREE from 'three';
import { makeDecalTexture, useShipMaterials, type ShipMaterials } from '../materials';

/**
 * HELIOS-9 canted twin tail fins.
 *
 * Twin fins cant 22 degrees outboard and are rooted on the engine nacelles
 * (nacelle axes at x +/-3.0, y -0.05; top of the casing sits near y 0.94).
 * The fin root fairing is embedded in the nacelle casing and the fin body is
 * lifted clear of it so the root spars, torque tube and actuator pushrods are
 * exposed in a 0.11 m mechanical gap. Envelope: fin top y <= +3.6, z -4.55 to
 * -6.0, fin tip x +/-3.94.
 *
 * All geometry is generated directly in assembled world coordinates for both
 * sides; the loft builder derives winding from projected ring area so left and
 * right fins keep outward normals.
 */

type MatKey = keyof ShipMaterials;

interface Piece {
  mat: MatKey;
  geo: THREE.BufferGeometry;
}

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

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

  const advance = centroid(rings[stations - 1]).sub(centroid(rings[0]));
  if (advance.lengthSq() < 1e-12) advance.set(0, 1, 0);
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

function bake(
  geo: THREE.BufferGeometry,
  position: THREE.Vector3,
  direction?: THREE.Vector3,
  scale?: THREE.Vector3,
): THREE.BufferGeometry {
  const quat = new THREE.Quaternion();
  if (direction) quat.setFromUnitVectors(UP, direction.clone().normalize());
  geo.applyMatrix4(new THREE.Matrix4().compose(position, quat, scale ?? ONE));
  return geo;
}

function bakeZ(geo: THREE.BufferGeometry, position: THREE.Vector3, axis: THREE.Vector3): THREE.BufferGeometry {
  const quat = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, axis.clone().normalize());
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

function featherValue(t: number, amount: number): number {
  if (amount <= 0) return 1;
  const raw = Math.min(1, Math.min(t, 1 - t) / amount);
  return raw * raw * (3 - 2 * raw);
}

/* ------------------------------------------------------------- fin frames */

const CANT = 22 * DEG;
const BASE_X = 2.95;
const BASE_Y = 1.16;
const FIN_HEIGHT = 2.61;
const ROOT_LE = -4.6;
const ROOT_TE = -5.58;
const TIP_LE = -5.06;
const TIP_TE = -5.68;
const ROOT_THICKNESS = 0.19;
const TIP_THICKNESS = 0.065;
const RUDDER_DEFLECTION = 3.5 * DEG;

interface FinFrame {
  sign: number;
  span: THREE.Vector3;
  thickness: THREE.Vector3;
  outboard: THREE.Vector3;
  base: THREE.Vector3;
}

function finFrame(sign: number): FinFrame {
  const span = new THREE.Vector3(sign * Math.sin(CANT), Math.cos(CANT), 0).normalize();
  const thickness = new THREE.Vector3().crossVectors(span, Z_AXIS).normalize();
  return {
    sign,
    span,
    thickness,
    outboard: thickness.clone().multiplyScalar(sign),
    base: new THREE.Vector3(sign * BASE_X, BASE_Y, 0),
  };
}

function finChordAt(t: number): { le: number; te: number; thickness: number } {
  return {
    le: THREE.MathUtils.lerp(ROOT_LE, TIP_LE, t),
    te: THREE.MathUtils.lerp(ROOT_TE, TIP_TE, t),
    thickness: THREE.MathUtils.lerp(ROOT_THICKNESS, TIP_THICKNESS, t),
  };
}

function finPoint(frame: FinFrame, t: number, u: number, h: number, outward = 0): THREE.Vector3 {
  const chord = finChordAt(t);
  const center = frame.base.clone().addScaledVector(frame.span, FIN_HEIGHT * t);
  return center
    .add(new THREE.Vector3(0, 0, chord.le + u * (chord.te - chord.le)))
    .addScaledVector(frame.thickness, h * chord.thickness * 0.5 + outward);
}

/** Symmetric diamond-ish supersonic fin section, 30 points around the loop. */
const FIN_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.008, 0.25],
  [0.025, 0.45],
  [0.06, 0.65],
  [0.11, 0.82],
  [0.18, 0.94],
  [0.28, 1.0],
  [0.4, 1.0],
  [0.52, 0.95],
  [0.64, 0.85],
  [0.75, 0.7],
  [0.84, 0.52],
  [0.91, 0.35],
  [0.96, 0.2],
  [1.0, 0.08],
  [1.0, -0.08],
  [0.96, -0.2],
  [0.91, -0.35],
  [0.84, -0.52],
  [0.75, -0.7],
  [0.64, -0.85],
  [0.52, -0.95],
  [0.4, -1.0],
  [0.28, -1.0],
  [0.18, -0.94],
  [0.11, -0.82],
  [0.06, -0.65],
  [0.025, -0.45],
  [0.008, -0.25],
];

const RUDDER_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.015, 0.35],
  [0.05, 0.65],
  [0.12, 0.88],
  [0.24, 1.0],
  [0.4, 0.94],
  [0.56, 0.82],
  [0.7, 0.64],
  [0.82, 0.44],
  [0.92, 0.24],
  [1.0, 0.06],
  [1.0, -0.06],
  [0.92, -0.2],
  [0.82, -0.36],
  [0.7, -0.5],
  [0.56, -0.62],
  [0.4, -0.7],
  [0.24, -0.7],
  [0.12, -0.6],
  [0.05, -0.42],
  [0.015, -0.22],
];

interface FinRing {
  points: THREE.Vector3[];
  normals: THREE.Vector3[];
}

function finStationRing(frame: FinFrame, t: number): FinRing {
  const points = FIN_PROFILE.map(([u, h]) => finPoint(frame, t, u, h));
  const center = finPoint(frame, t, 0.46, 0);
  const count = points.length;
  const normals = points.map((point, index) => {
    const prev = points[(index - 1 + count) % count];
    const next = points[(index + 1) % count];
    const tangent = next.clone().sub(prev);
    const normal = new THREE.Vector3().crossVectors(tangent, frame.span);
    if (normal.lengthSq() < 1e-12) normal.copy(frame.thickness);
    normal.normalize();
    if (normal.dot(point.clone().sub(center)) < 0) normal.negate();
    return normal;
  });
  return { points, normals };
}

function finStations(t0: number, t1: number, count: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const f = count === 1 ? 0.5 : i / (count - 1);
    list.push(THREE.MathUtils.lerp(t0, t1, f));
  }
  return list;
}

/** Curved shell hugging the fin surface between two offset levels. */
function finShellRings(
  frame: FinFrame,
  stations: number[],
  indexSeq: number[],
  offsetOuter: number,
  offsetInner: number,
  featherAmount = 0.16,
): THREE.Vector3[][] {
  const count = stations.length;
  return stations.map((t, stationIndex) => {
    const { points, normals } = finStationRing(frame, t);
    const f = featherValue(count === 1 ? 0.5 : stationIndex / (count - 1), featherAmount);
    const outerOffset = offsetInner + Math.max(0.0006, (offsetOuter - offsetInner) * f);
    const ring: THREE.Vector3[] = [];
    indexSeq.forEach((index) => {
      ring.push(points[index].clone().addScaledVector(normals[index], outerOffset));
    });
    [...indexSeq].reverse().forEach((index) => {
      ring.push(points[index].clone().addScaledVector(normals[index], offsetInner));
    });
    return ring;
  });
}

/* ------------------------------------------------------------ sub builders */

function buildFairing(frame: FinFrame, pieces: Piece[]): void {
  // Arch fairing embedded in the nacelle top: an elliptic loft along z.
  const stations = [-4.65, -4.78, -4.95, -5.15, -5.35, -5.55, -5.72, -5.85];
  const rings = stations.map((z, index) => {
    const t = index / (stations.length - 1);
    const scale = 0.48 + 0.52 * Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1));
    const ring: THREE.Vector3[] = [];
    const segments = 16;
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      ring.push(
        new THREE.Vector3(
          frame.sign * BASE_X + Math.cos(angle) * 0.36 * scale,
          0.93 + Math.sin(angle) * 0.12 * scale,
          z,
        ),
      );
    }
    return ring;
  });
  pieces.push({ mat: 'hull', geo: loft(rings, { capStart: true, capEnd: true, uvRepeat: 2 }) });

  // Fairing seam bands.
  [-4.8, -5.25, -5.65].forEach((z) => {
    const t = (z - stations[0]) / (stations[stations.length - 1] - stations[0]);
    const scale = 0.48 + 0.52 * Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1));
    const radiusX = 0.36 * scale + 0.006;
    const radiusY = 0.12 * scale + 0.006;
    const ring: THREE.Vector3[] = [];
    const ring2: THREE.Vector3[] = [];
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      for (const zz of [z - 0.008, z + 0.008]) {
        (zz < z ? ring : ring2).push(
          new THREE.Vector3(
            frame.sign * BASE_X + Math.cos(angle) * radiusX,
            0.93 + Math.sin(angle) * radiusY,
            zz,
          ),
        );
      }
    }
    pieces.push({ mat: 'trim', geo: loft([ring, ring2], { uvRepeat: 1 }) });
  });

  // Fairing top fasteners.
  for (let i = 0; i < 7; i += 1) {
    const z = -4.68 - i * 0.17;
    const t = (z - stations[0]) / (stations[stations.length - 1] - stations[0]);
    const scale = 0.48 + 0.52 * Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1));
    pieces.push({
      mat: 'trim',
      geo: boltGeo(
        new THREE.Vector3(frame.sign * BASE_X, 0.93 + 0.12 * scale, z),
        new THREE.Vector3(frame.outboard.x * 0.35, 1, frame.outboard.z),
        0.012,
        0.018,
      ),
    });
  }

  // Exposed root structure: three routed spar stubs + a torque tube.
  [-4.8, -5.25, -5.7].forEach((z) => {
    const rings: THREE.Vector3[][] = [];
    const heights = [0.94, 1.0, 1.1, 1.17];
    heights.forEach((y, index) => {
      const flange = index === 0 || index === heights.length - 1 ? 1.45 : 0.82;
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k < 8; k += 1) {
        const angle = (k / 8) * Math.PI * 2;
        const sx = Math.cos(angle) >= 0 ? 0.028 * flange : -0.028 * flange;
        const sz = Math.sin(angle) >= 0 ? 0.085 * flange : -0.085 * flange;
        ring.push(new THREE.Vector3(frame.sign * BASE_X + sx, y, z + sz));
      }
      rings.push(ring);
    });
    pieces.push({ mat: 'trim', geo: loft(rings, { capStart: true, capEnd: true, uvRepeat: 1 }) });
    [-1, 1].forEach((side) => {
      pieces.push({
        mat: 'dark',
        geo: boltGeo(
          new THREE.Vector3(frame.sign * BASE_X + side * 0.045, 1.13, z),
          new THREE.Vector3(frame.sign, 0, 0),
          0.012,
          0.016,
        ),
      });
    });
  });
  pieces.push({
    mat: 'trim',
    geo: cylinderBetween(
      new THREE.Vector3(frame.sign * BASE_X, 1.065, -4.85),
      new THREE.Vector3(frame.sign * BASE_X, 1.065, -5.75),
      0.045,
      0.045,
      12,
    ),
  });
  [-4.95, -5.35, -5.7].forEach((z) => {
    pieces.push({
      mat: 'dark',
      geo: cylinderBetween(
        new THREE.Vector3(frame.sign * BASE_X, 1.065, z - 0.02),
        new THREE.Vector3(frame.sign * BASE_X, 1.065, z + 0.02),
        0.062,
        0.062,
        12,
      ),
    });
  });
}

function buildRudder(frame: FinFrame, pieces: Piece[]): void {
  const stations = finStations(0.08, 0.94, 9);
  const rudderChord = (t: number) => THREE.MathUtils.lerp(0.3, 0.2, t);
  const chordDir = new THREE.Vector3(0, 0, -1);
  const deflectedChord = chordDir
    .clone()
    .multiplyScalar(Math.cos(RUDDER_DEFLECTION))
    .addScaledVector(frame.thickness, Math.sin(RUDDER_DEFLECTION));
  const deflectedNormal = frame.thickness
    .clone()
    .multiplyScalar(Math.cos(RUDDER_DEFLECTION))
    .addScaledVector(chordDir, -Math.sin(RUDDER_DEFLECTION));

  const rings = stations.map((t) => {
    const chord = finChordAt(t);
    const hinge = new THREE.Vector3(0, 0, chord.te - 0.035)
      .add(frame.base)
      .addScaledVector(frame.span, FIN_HEIGHT * t);
    const thickness = THREE.MathUtils.lerp(0.07, 0.04, t);
    const c = rudderChord(t);
    return RUDDER_PROFILE.map(([u, h]) =>
      hinge
        .clone()
        .addScaledVector(deflectedChord, u * c)
        .addScaledVector(deflectedNormal, h * thickness * 0.5),
    );
  });
  pieces.push({ mat: 'hull', geo: loft(rings, { capStart: true, capEnd: true, uvRepeat: 3 }) });

  // Hinge line: a dark torque rod plus three machined knuckles.
  const hingeStart = new THREE.Vector3(0, 0, finChordAt(0.08).te - 0.035)
    .add(frame.base)
    .addScaledVector(frame.span, FIN_HEIGHT * 0.08);
  const hingeEnd = new THREE.Vector3(0, 0, finChordAt(0.94).te - 0.035)
    .add(frame.base)
    .addScaledVector(frame.span, FIN_HEIGHT * 0.94);
  pieces.push({
    mat: 'dark',
    geo: cylinderBetween(hingeStart, hingeEnd, 0.016, 0.016, 8),
  });
  [0.2, 0.5, 0.8].forEach((k) => {
    const point = hingeStart.clone().lerp(hingeEnd, k);
    pieces.push({
      mat: 'trim',
      geo: cylinderBetween(
        point.clone().addScaledVector(frame.span, -0.045),
        point.clone().addScaledVector(frame.span, 0.045),
        0.026,
        0.026,
        8,
      ),
    });
  });

  // Two hydraulic actuators at the root, with pushrods to rudder horns.
  [-4.9, -5.45].forEach((z) => {
    const fairingCenter = new THREE.Vector3(frame.sign * BASE_X, 1.015, z);
    const fairingRings: THREE.Vector3[][] = [];
    [-0.19, -0.15, 0.15, 0.19].forEach((dz) => {
      const scale = Math.abs(dz) > 0.17 ? 0.55 : 1;
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i < 10; i += 1) {
        const angle = (i / 10) * Math.PI * 2;
        ring.push(
          new THREE.Vector3(
            frame.sign * BASE_X + Math.cos(angle) * 0.09 * scale,
            1.015 + Math.sin(angle) * 0.06 * scale,
            z + dz,
          ),
        );
      }
      fairingRings.push(ring);
    });
    pieces.push({ mat: 'hull', geo: loft(fairingRings, { capStart: true, capEnd: true, uvRepeat: 1 }) });

    const hornT = 0.16;
    const chord = finChordAt(hornT);
    const horn = new THREE.Vector3(0, 0, chord.te - 0.035 + 0.12)
      .add(frame.base)
      .addScaledVector(frame.span, FIN_HEIGHT * hornT)
      .addScaledVector(frame.thickness, 0.045);
    const start = new THREE.Vector3(frame.sign * BASE_X, 1.05, z + 0.16);
    const mid = start.clone().lerp(horn, 0.45);
    pieces.push({ mat: 'trim', geo: cylinderBetween(start, mid, 0.03, 0.026, 10) });
    pieces.push({ mat: 'black', geo: cylinderBetween(mid, horn, 0.014, 0.014, 8) });
    pieces.push({
      mat: 'trim',
      geo: bake(new THREE.BoxGeometry(0.06, 0.012, 0.1), horn, frame.span),
    });
  });
}

function buildRcs(frame: FinFrame, pieces: Piece[]): void {
  // Tip cluster on the outboard skin.
  const t = 0.9;
  const base = finPoint(frame, t, 0.34, 1.0).addScaledVector(frame.outboard, 0.012);
  const dirs = [
    frame.outboard.clone(),
    frame.outboard.clone().addScaledVector(frame.span, 0.55).normalize(),
    frame.outboard.clone().addScaledVector(Z_AXIS, -0.7).normalize(),
    frame.outboard.clone().addScaledVector(Z_AXIS, 0.55).normalize(),
  ];
  const housingRings: THREE.Vector3[][] = [];
  [0, 0.3, 1].forEach((s) => {
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      ring.push(
        base
          .clone()
          .addScaledVector(frame.outboard, s * 0.055)
          .addScaledVector(frame.span, Math.cos(angle) * 0.13 * (1 - s * 0.35))
          .addScaledVector(Z_AXIS, Math.sin(angle) * 0.1 * (1 - s * 0.35)),
      );
    }
    housingRings.push(ring);
  });
  pieces.push({ mat: 'trim', geo: loft(housingRings, { capStart: true, capEnd: true, uvRepeat: 1 }) });
  dirs.forEach((dir, index) => {
    const pos = base
      .clone()
      .addScaledVector(frame.outboard, 0.06)
      .addScaledVector(frame.span, (index - 1.5) * 0.045)
      .addScaledVector(Z_AXIS, index % 2 === 0 ? -0.045 : 0.045);
    const nozzle = new THREE.CylinderGeometry(0.024, 0.034, 0.05, 8, 1, true);
    pieces.push({ mat: 'black', geo: bake(nozzle, pos, dir) });
    const lip = new THREE.TorusGeometry(0.033, 0.006, 4, 9);
    pieces.push({ mat: 'ceramic', geo: bakeZ(lip, pos.clone().addScaledVector(dir, 0.02), dir) });
    const glow = new THREE.CircleGeometry(0.016, 9);
    pieces.push({ mat: 'glowCyan', geo: bakeZ(glow, pos.clone().addScaledVector(dir, -0.014), dir) });
  });

  // Small base cluster near the fin root.
  const rootBase = finPoint(frame, 0.2, 0.62, 1.0).addScaledVector(frame.outboard, 0.01);
  const housing = new THREE.CylinderGeometry(0.05, 0.06, 0.06, 8, 1, false);
  pieces.push({ mat: 'trim', geo: bake(housing, rootBase, frame.outboard) });
  [-1, 1].forEach((side) => {
    const pos = rootBase
      .clone()
      .addScaledVector(frame.outboard, 0.035)
      .addScaledVector(frame.span, side * 0.06);
    const nozzle = new THREE.CylinderGeometry(0.018, 0.026, 0.04, 8, 1, true);
    pieces.push({ mat: 'black', geo: bake(nozzle, pos, frame.outboard) });
    const glow = new THREE.CircleGeometry(0.012, 8);
    pieces.push({ mat: 'glowCyan', geo: bakeZ(glow, pos.clone().addScaledVector(frame.outboard, -0.01), frame.outboard) });
  });
}

function buildFin(frame: FinFrame, pieces: Piece[]): void {
  // Primary fin surface.
  const skinStations = finStations(0.0, 1.0, 13);
  pieces.push({
    mat: 'hull',
    geo: loft(skinStations.map((t) => finStationRing(frame, t).points), {
      capStart: true,
      capEnd: true,
      uvRepeat: 6,
    }),
  });

  // Root rib plate hiding the embedded end of the fin.
  const rootRibStations = finStations(0.0, 0.012, 3);
  const rootRibRings = rootRibStations.map((t) => finStationRing(frame, t).points);
  pieces.push({ mat: 'trim', geo: loft(rootRibRings, { capStart: true, capEnd: true, uvRepeat: 1 }) });
  pieces.push({
    mat: 'dark',
    geo: loft(
      rootRibStations.map((t) =>
        finStationRing(frame, t).points.map((point) => {
          const center = finPoint(frame, t, 0.46, 0);
          return center.clone().addScaledVector(point.clone().sub(center), 0.95);
        }),
      ),
      { capStart: true, capEnd: true, uvRepeat: 1 },
    ),
  });

  // Ceramic tip cap.
  const tipRings = [0.985, 1.0].map((t) =>
    FIN_PROFILE.map(([u, h]) => {
      const chord = finChordAt(t);
      const scale = t > 0.99 ? 0.99 : 1.02;
      const center = frame.base.clone().addScaledVector(frame.span, FIN_HEIGHT * t);
      return center
        .add(new THREE.Vector3(0, 0, 0.5 * (chord.le + chord.te)))
        .add(
          new THREE.Vector3(
            0,
            0,
            (chord.le + u * (chord.te - chord.le) - 0.5 * (chord.le + chord.te)) * scale,
          ),
        )
        .addScaledVector(frame.thickness, h * chord.thickness * 0.5 * scale);
    }),
  );
  pieces.push({ mat: 'ceramic', geo: loft(tipRings, { capStart: true, capEnd: true, uvRepeat: 1 }) });

  // Layered leading-edge armour, two segments per fin.
  const leIndexSeq = [4, 3, 2, 1, 0, 28, 27, 26, 25, 24];
  [
    [0.04, 0.48],
    [0.52, 0.97],
  ].forEach(([t0, t1]) => {
    pieces.push({
      mat: 'ceramic',
      geo: loft(
        finShellRings(frame, finStations(t0, t1, 7), leIndexSeq, 0.022, 0.003, 0.16),
        { uvRepeat: 4 },
      ),
    });
  });
  // Leading edge fastener line.
  [0.15, 0.35, 0.55, 0.75, 0.92].forEach((t) => {
    const sample = finStationRing(frame, t);
    pieces.push({
      mat: 'trim',
      geo: boltGeo(
        sample.points[2].clone().addScaledVector(sample.normals[2], 0.026),
        sample.normals[2],
        0.011,
        0.016,
      ),
    });
    pieces.push({
      mat: 'trim',
      geo: boltGeo(
        sample.points[27].clone().addScaledVector(sample.normals[27], 0.026),
        sample.normals[27],
        0.011,
        0.016,
      ),
    });
  });

  // Access panels on both skins + seam lines.
  [
    [0.18, 0.62, [8, 9, 10, 11, 12]],
    [0.64, 0.9, [10, 11, 12, 13]],
  ].forEach(([t0, t1, indices]) => {
    pieces.push({
      mat: 'hull',
      geo: loft(
        finShellRings(frame, finStations(t0 as number, t1 as number, 5), indices as number[], 0.014, 0.002, 0.2),
        { uvRepeat: 2 },
      ),
    });
    pieces.push({
      mat: 'hull',
      geo: loft(
        finShellRings(
          frame,
          finStations(t0 as number, t1 as number, 5),
          (indices as number[]).map((index) => 28 - index).filter((index) => index >= 15 && index <= 24),
          0.012,
          0.002,
          0.2,
        ),
        { uvRepeat: 2 },
      ),
    });
  });
  [
    [0.12, 0.9, [9, 10]],
    [0.16, 0.86, [19, 20]],
  ].forEach(([t0, t1, indices]) => {
    pieces.push({
      mat: 'dark',
      geo: loft(
        finShellRings(frame, finStations(t0 as number, t1 as number, 8), indices as number[], 0.003, 0.0008, 0.08),
        { uvRepeat: 2 },
      ),
    });
  });

  // Panel fasteners.
  [
    [0.22, 9],
    [0.34, 12],
    [0.5, 10],
    [0.7, 13],
    [0.8, 11],
  ].forEach(([t, index]) => {
    const sample = finStationRing(frame, t);
    pieces.push({
      mat: 'trim',
      geo: boltGeo(
        sample.points[index].clone().addScaledVector(sample.normals[index], 0.018),
        sample.normals[index],
        0.01,
        0.014,
      ),
    });
  });

  // Tip formation light + static dischargers.
  const lightSample = finStationRing(frame, 0.96);
  const lightPos = lightSample.points[2].clone().addScaledVector(lightSample.normals[2], 0.012);
  pieces.push({ mat: 'glowCyan', geo: bake(new THREE.SphereGeometry(0.028, 9, 7), lightPos, lightSample.normals[2]) });
  pieces.push({
    mat: 'trim',
    geo: bakeZ(new THREE.TorusGeometry(0.034, 0.007, 4, 10), lightPos.clone().addScaledVector(lightSample.normals[2], 0.004), lightSample.normals[2]),
  });
  [0.9, 0.96].forEach((t) => {
    const sample = finStationRing(frame, t);
    const tip = sample.points[15].clone();
    const end = tip.clone().add(new THREE.Vector3(0, 0.01, -0.14));
    pieces.push({ mat: 'black', geo: cylinderBetween(tip, end, 0.009, 0.0015, 5) });
  });

  // Blade antenna at the tip trailing edge.
  const antennaBase = finStationRing(frame, 0.9).points[15].clone();
  const blade = new THREE.BoxGeometry(0.012, 0.26, 0.08);
  blade.applyMatrix4(
    new THREE.Matrix4().compose(
      antennaBase.clone().add(new THREE.Vector3(0, 0.1, -0.12)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.65, frame.sign * 0.18, frame.sign * 0.12)),
      ONE,
    ),
  );
  pieces.push({ mat: 'trim', geo: blade });
  pieces.push({
    mat: 'dark',
    geo: bake(new THREE.CylinderGeometry(0.035, 0.042, 0.026, 8), antennaBase.clone(), UP),
  });

  buildRudder(frame, pieces);
  buildRcs(frame, pieces);
}

function buildTailFinPieces(): Piece[] {
  const pieces: Piece[] = [];
  [1, -1].forEach((sign) => {
    const frame = finFrame(sign);
    buildFairing(frame, pieces);
    buildFin(frame, pieces);
  });
  return pieces;
}

/* --------------------------------------------------------------- decals */

interface DecalPart {
  geo: THREE.BufferGeometry;
  material: THREE.Material;
}

function buildFinDecals(): DecalPart[] {
  const parts: DecalPart[] = [];
  const makeMaterial = (texture: THREE.Texture) =>
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });

  const nameTexture = makeDecalTexture(['VECTOR FIN'], {
    width: 512,
    height: 192,
    color: '#ccd8dc',
    accent: '#5fe7f2',
    align: 'center',
  });
  const registryTexture = makeDecalTexture(['AX-09'], {
    width: 512,
    height: 192,
    color: '#c4cfd3',
    accent: '#5fe7f2',
    align: 'center',
  });

  [1, -1].forEach((sign) => {
    const frame = finFrame(sign);
    [
      { t: 0.58, u: 0.52, texture: nameTexture, width: 0.5, height: 0.13 },
      { t: 0.26, u: 0.5, texture: registryTexture, width: 0.34, height: 0.12 },
    ].forEach(({ t, u, texture, width, height }) => {
      const sample = finStationRing(frame, t);
      const index = FIN_PROFILE.findIndex(([profileU]) => profileU >= u);
      const targetIndex = index < 0 ? 10 : index;
      const normal = sample.normals[frame.sign > 0 ? targetIndex : 28 - targetIndex];
      const base =
        frame.sign > 0 ? sample.points[targetIndex] : sample.points[28 - targetIndex];
      const center = base.clone().addScaledVector(normal, 0.012);
      const up = frame.span.clone().multiplyScalar(frame.sign);
      parts.push({
        geo: decalGeometry(width, height, center, normal, up),
        material: makeMaterial(texture),
      });
    });
  });

  return parts;
}

/* ------------------------------------------------------------- component */

const finGeometryCache = new Map<'fin', Array<{ mat: MatKey; geo: THREE.BufferGeometry }>>();
let finPieces: Piece[] | null = null;

function finGeometries() {
  const cached = finGeometryCache.get('fin');
  if (cached) return cached;
  if (!finPieces) finPieces = buildTailFinPieces();
  const merged = mergePieces(finPieces);
  finGeometryCache.set('fin', merged);
  return merged;
}

function FinDecals() {
  const parts = useMemo(() => buildFinDecals(), []);
  return (
    <>
      {parts.map((part, index) => (
        <mesh key={`fin-decal-${index}`} geometry={part.geo} material={part.material} renderOrder={3} />
      ))}
    </>
  );
}

export function TailFin() {
  const materials = useShipMaterials();
  const meshes = useMemo(() => finGeometries(), []);
  return (
    <group name="tail-fin">
      {meshes.map(({ mat, geo }) => (
        <mesh key={mat} geometry={geo} material={materials[mat]} castShadow receiveShadow />
      ))}
      <FinDecals />
    </group>
  );
}

/* --------------------------------------------------------- introspection */

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

export interface TailFinInspection {
  triangles: number;
  meshes: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export function inspectTailFin(): TailFinInspection {
  const meshes = finGeometries();
  let triangles = 0;
  const box = new THREE.Box3();
  meshes.forEach(({ geo }) => {
    triangles += geo.getAttribute('position').count / 3;
    geo.computeBoundingBox();
    if (geo.boundingBox) box.union(geo.boundingBox);
  });
  return {
    triangles: Math.round(triangles),
    meshes: meshes.length,
    bounds: {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    },
  };
}

export interface TailFinPieceDiagnostics {
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

export function tailFinPieceDiagnostics(): TailFinPieceDiagnostics {
  if (!finPieces) finPieces = buildTailFinPieces();
  let triangles = 0;
  let nearZeroPieces = 0;
  const negativePieces: TailFinPieceDiagnostics['negativePieces'] = [];
  finPieces.forEach(({ mat, geo }) => {
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
    pieces: finPieces.length,
    triangles: Math.round(triangles),
    negativePieces,
    nearZeroPieces,
  };
}

/** Raw merged geometry, exposed for offline/QA inspection. */
export function tailFinMeshGeometries(): THREE.BufferGeometry[] {
  return finGeometries().map((entry) => entry.geo);
}
