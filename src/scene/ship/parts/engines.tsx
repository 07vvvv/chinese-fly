import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useShip } from '../../../state/ship';
import { makeDecalTexture, useShipMaterials } from '../materials';
import { PlasmaPlume } from '../../effects/PlasmaPlume';

/**
 * VECTOR-9 plasma ramjet nacelle.
 *
 * Local coordinate system: origin at the nacelle centre (world x +/-3.0,
 * y -0.05, z -4.55), +Z = forward intake, -Z = aft nozzle. The module is
 * 4.6 m long, so the intake lip sits at z +2.28 and the ceramic petal exit
 * plane at z -2.30 (world z -6.85). The engine part group applies the exploded
 * translation, and the plume is rendered as an absolute-position sibling so it
 * inherits the same explode transform.
 */

const TAU = Math.PI * 2;

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const PETAL_COUNT = 14;
const FIN_COUNT = 14;
const BLADE_COUNT = 16;
const VANE_COUNT = 6;
const PIPE_ANGLES = [20, 160, 200, 340].map((deg) => THREE.MathUtils.degToRad(deg));
const CLAMP_Z = [1.75, 0.85, -0.1, -1.05];
const PISTON_ANGLES = [60, 180, 300].map((deg) => THREE.MathUtils.degToRad(deg));

const SHELL_SECTIONS = [
  { z0: 2.28, z1: 1.3, r0: 0.9, r1: 0.962, heat: false },
  { z0: 1.3, z1: 0.3, r0: 0.962, r1: 0.988, heat: false },
  { z0: 0.3, z1: -0.75, r0: 0.988, r1: 0.978, heat: false },
  { z0: -0.75, z1: -1.6, r0: 0.978, r1: 0.925, heat: false },
  { z0: -1.6, z1: -2.0, r0: 0.925, r1: 0.835, heat: true },
  { z0: -2.0, z1: -2.3, r0: 0.835, r1: 0.79, heat: true },
];

const SEAM_RINGS = [
  { z: 1.3, r: 0.962 },
  { z: 0.3, r: 0.988 },
  { z: -0.75, r: 0.978 },
  { z: -1.6, r: 0.925 },
];

const STATIONS = [
  { z: 2.28, r: 0.9 },
  { z: 1.3, r: 0.962 },
  { z: 0.3, r: 0.988 },
  { z: -0.75, r: 0.978 },
  { z: -1.6, r: 0.925 },
  { z: -2.0, r: 0.835 },
  { z: -2.3, r: 0.79 },
];

function radiusAt(z: number) {
  if (z >= STATIONS[0].z) return STATIONS[0].r;
  const last = STATIONS[STATIONS.length - 1];
  if (z <= last.z) return last.r;
  for (let i = 0; i < STATIONS.length - 1; i += 1) {
    const a = STATIONS[i];
    const b = STATIONS[i + 1];
    if (z <= a.z && z >= b.z) {
      const t = (a.z - z) / (a.z - b.z);
      return THREE.MathUtils.lerp(a.r, b.r, t);
    }
  }
  return last.r;
}

function makeRandom(seed: number) {
  let value = seed % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function matrixAt(
  position: THREE.Vector3,
  rotation: THREE.Quaternion,
  scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1),
) {
  return new THREE.Matrix4().compose(position, rotation, scale);
}

function quatZ(angle: number) {
  return new THREE.Quaternion().setFromAxisAngle(Z_AXIS, angle);
}

function quatY(angle: number) {
  return new THREE.Quaternion().setFromAxisAngle(Y_AXIS, angle);
}

function quatX(angle: number) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
}

let heatTexture: THREE.CanvasTexture | null = null;

function getHeatTexture() {
  if (heatTexture) return heatTexture;
  const width = 256;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const random = makeRandom(451);

  // Exhaust heat discolouration: soot -> straw -> gold -> iridescent blue/purple.
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#26231f');
  gradient.addColorStop(0.24, '#463b31');
  gradient.addColorStop(0.44, '#7d6042');
  gradient.addColorStop(0.58, '#b08350');
  gradient.addColorStop(0.68, '#b99a68');
  gradient.addColorStop(0.78, '#6c6b96');
  gradient.addColorStop(0.88, '#8c6d8f');
  gradient.addColorStop(1, '#4b4048');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Axial heat streaks.
  for (let i = 0; i < 90; i += 1) {
    const x = random() * width;
    const w = 0.6 + random() * 2.4;
    const alpha = 0.03 + random() * 0.08;
    ctx.fillStyle =
      random() > 0.5 ? `rgba(255, 214, 160, ${alpha})` : `rgba(28, 22, 18, ${alpha})`;
    ctx.fillRect(x, 0, w, height);
  }

  // Blotchy thermal staining.
  for (let i = 0; i < 70; i += 1) {
    const x = random() * width;
    const y = random() * height;
    const r = 4 + random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = random() > 0.45;
    g.addColorStop(0, warm ? 'rgba(214, 158, 84, 0.16)' : 'rgba(58, 48, 76, 0.18)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  heatTexture = new THREE.CanvasTexture(canvas);
  heatTexture.colorSpace = THREE.SRGBColorSpace;
  heatTexture.wrapS = THREE.RepeatWrapping;
  heatTexture.wrapT = THREE.ClampToEdgeWrapping;
  heatTexture.anisotropy = 8;
  heatTexture.needsUpdate = true;
  return heatTexture;
}

let decalTexture: THREE.CanvasTexture | null = null;

function getEngineDecal() {
  if (decalTexture) return decalTexture;
  decalTexture = makeDecalTexture(['VECTOR-9', 'PLASMA RAMJET / SN 09-114'], {
    width: 768,
    height: 256,
    color: '#cfd9de',
    accent: '#ff8a3d',
    align: 'left',
  });
  return decalTexture;
}

interface EngineAssets {
  sections: { geometry: THREE.BufferGeometry; z: number; heat: boolean }[];
  seamRings: { geometry: THREE.BufferGeometry; z: number }[];
  heatShellMaterial: THREE.MeshStandardMaterial;
  glowMaterial: THREE.MeshStandardMaterial;
  nozzleInnerMaterial: THREE.MeshStandardMaterial;
  petalDarkMaterial: THREE.MeshStandardMaterial;
  lensMaterial: THREE.MeshStandardMaterial;
  decalMaterial: THREE.MeshStandardMaterial;
  linerMaterial: THREE.MeshStandardMaterial;
  lipGeometry: THREE.BufferGeometry;
  accentRingGeometry: THREE.BufferGeometry;
  intakeLinerGeometry: THREE.BufferGeometry;
  intakeGlowGeometry: THREE.BufferGeometry;
  fanDiscGeometry: THREE.BufferGeometry;
  fanHubGeometry: THREE.BufferGeometry;
  bladeGeometry: THREE.BufferGeometry;
  vaneGeometry: THREE.BufferGeometry;
  fanBladeMatrices: THREE.Matrix4[];
  vaneMatrices: THREE.Matrix4[];
  actuatorRings: { geometry: THREE.BufferGeometry; z: number }[];
  pistonBodyGeometry: THREE.BufferGeometry;
  pistonRodGeometry: THREE.BufferGeometry;
  bracketGeometry: THREE.BufferGeometry;
  pistonMatrices: { body: THREE.Matrix4; rod: THREE.Matrix4 }[];
  bracketMatrices: THREE.Matrix4[];
  pipeGeometry: THREE.BufferGeometry;
  pipeMatrices: THREE.Matrix4[];
  clampGeometry: THREE.BufferGeometry;
  clampMatrices: THREE.Matrix4[];
  finGeometry: THREE.BufferGeometry;
  finMatrices: THREE.Matrix4[];
  petalGeometry: THREE.BufferGeometry;
  petalMatrices: THREE.Matrix4[];
  underPetalGeometry: THREE.BufferGeometry;
  underPetalMatrices: THREE.Matrix4[];
  nozzleRimGeometry: THREE.BufferGeometry;
  nozzleBackplateGeometry: THREE.BufferGeometry;
  innerNozzleGeometry: THREE.BufferGeometry;
  throatGeometry: THREE.BufferGeometry;
  plugGeometry: THREE.BufferGeometry;
  decalPlateGeometry: THREE.BufferGeometry;
  decalPlaneGeometry: THREE.BufferGeometry;
  pylonGeometry: THREE.BufferGeometry;
  pylonStrutGeometry: THREE.BufferGeometry;
  pylonAccentGeometry: THREE.BufferGeometry;
  blisterGeometry: THREE.BufferGeometry;
  lensDotGeometry: THREE.BufferGeometry;
  greebleGeometry: THREE.BufferGeometry;
}

let engineAssets: EngineAssets | null = null;

function buildEngineAssets(): EngineAssets {
  const heat = getHeatTexture();
  const decal = getEngineDecal();

  const heatShellMaterial = new THREE.MeshStandardMaterial({
    map: heat,
    color: '#cfc8bb',
    metalness: 0.74,
    roughness: 0.4,
    emissive: new THREE.Color('#ff4d10'),
    emissiveIntensity: 0.04,
    envMapIntensity: 1.1,
  });

  const glowMaterial = new THREE.MeshStandardMaterial({
    color: '#ffd7b0',
    emissive: new THREE.Color('#ff6a1f'),
    emissiveIntensity: 1.4,
    metalness: 0.12,
    roughness: 0.28,
    toneMapped: false,
  });

  const nozzleInnerMaterial = new THREE.MeshStandardMaterial({
    map: heat,
    color: '#cabfae',
    metalness: 0.66,
    roughness: 0.44,
    side: THREE.DoubleSide,
    emissive: new THREE.Color('#ff4a10'),
    emissiveIntensity: 0.12,
  });

  const petalDarkMaterial = new THREE.MeshStandardMaterial({
    map: heat,
    color: '#9c9081',
    metalness: 0.82,
    roughness: 0.36,
    emissive: new THREE.Color('#ff5a16'),
    emissiveIntensity: 0.08,
  });

  const lensMaterial = new THREE.MeshStandardMaterial({
    color: '#c9fbff',
    emissive: new THREE.Color('#5fe7f2'),
    emissiveIntensity: 0.9,
    metalness: 0.15,
    roughness: 0.22,
    toneMapped: false,
  });

  const decalMaterial = new THREE.MeshStandardMaterial({
    map: decal,
    color: '#e6eef2',
    transparent: true,
    depthWrite: false,
    roughness: 0.55,
    metalness: 0.3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const linerMaterial = new THREE.MeshStandardMaterial({
    color: '#0a0f14',
    metalness: 0.55,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });

  const sections = SHELL_SECTIONS.map((section) => {
    const height = section.z0 - section.z1;
    const geometry = new THREE.CylinderGeometry(
      section.r0,
      section.r1,
      height,
      48,
      1,
      true,
    );
    geometry.rotateX(Math.PI / 2);
    geometry.computeBoundingSphere();
    return { geometry, z: (section.z0 + section.z1) / 2, heat: section.heat };
  });

  const seamRings = SEAM_RINGS.map((ring) => {
    const geometry = new THREE.TorusGeometry(ring.r + 0.005, 0.009, 8, 48);
    geometry.computeBoundingSphere();
    return { geometry, z: ring.z };
  });

  const lipGeometry = new THREE.TorusGeometry(0.86, 0.095, 14, 48);
  const accentRingGeometry = new THREE.TorusGeometry(0.936, 0.017, 8, 48);

  const intakeLinerGeometry = new THREE.CylinderGeometry(0.78, 0.7, 0.84, 40, 1, true);
  intakeLinerGeometry.rotateX(Math.PI / 2);

  const intakeGlowGeometry = new THREE.TorusGeometry(0.69, 0.018, 8, 40);
  const fanDiscGeometry = new THREE.CircleGeometry(0.68, 32);
  const fanHubGeometry = new THREE.ConeGeometry(0.15, 0.36, 20);
  fanHubGeometry.rotateX(Math.PI / 2);

  const bladeGeometry = new THREE.BoxGeometry(0.3, 0.018, 0.15);
  const fanBladeMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < BLADE_COUNT; i += 1) {
    const angle = (i / BLADE_COUNT) * TAU;
    const rotation = quatZ(angle).multiply(quatX(0.55));
    fanBladeMatrices.push(
      matrixAt(new THREE.Vector3(Math.cos(angle) * 0.44, Math.sin(angle) * 0.44, 1.63), rotation),
    );
  }

  const vaneGeometry = new THREE.BoxGeometry(0.22, 0.018, 0.1);
  const vaneMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < VANE_COUNT; i += 1) {
    const angle = (i / VANE_COUNT) * TAU + 0.2;
    const rotation = quatZ(angle).multiply(quatX(0.55));
    vaneMatrices.push(
      matrixAt(new THREE.Vector3(Math.cos(angle) * 0.66, Math.sin(angle) * 0.66, 2.1), rotation),
    );
  }

  const actuatorRings = [
    { z: 1.31, r: 0.972, tube: 0.026 },
    { z: 0.28, r: 1.0, tube: 0.028 },
    { z: -0.77, r: 0.99, tube: 0.026 },
    { z: -1.62, r: 0.936, tube: 0.022 },
  ].map((ring) => ({
    geometry: new THREE.TorusGeometry(ring.r, ring.tube, 10, 48),
    z: ring.z,
  }));

  const pistonBodyGeometry = new THREE.CylinderGeometry(0.034, 0.034, 0.72, 10);
  pistonBodyGeometry.rotateX(Math.PI / 2);
  const pistonRodGeometry = new THREE.CylinderGeometry(0.014, 0.014, 0.86, 8);
  pistonRodGeometry.rotateX(Math.PI / 2);
  const bracketGeometry = new THREE.BoxGeometry(0.09, 0.08, 0.07);

  const pistonMatrices: { body: THREE.Matrix4; rod: THREE.Matrix4 }[] = [];
  const bracketMatrices: THREE.Matrix4[] = [];
  for (const angle of PISTON_ANGLES) {
    const x = Math.cos(angle) * 1.012;
    const y = Math.sin(angle) * 1.012;
    pistonMatrices.push({
      body: matrixAt(new THREE.Vector3(x, y, 0.86), quatZ(0)),
      rod: matrixAt(new THREE.Vector3(x, y, 0.52), quatZ(0)),
    });
    bracketMatrices.push(
      matrixAt(new THREE.Vector3(x, y, 1.25), quatZ(angle)),
      matrixAt(new THREE.Vector3(x, y, 0.4), quatZ(angle)),
    );
  }

  const pipeGeometry = new THREE.CylinderGeometry(0.034, 0.034, 3.2, 10);
  pipeGeometry.rotateX(Math.PI / 2);
  const pipeMatrices: THREE.Matrix4[] = PIPE_ANGLES.map((angle) =>
    matrixAt(
      new THREE.Vector3(Math.cos(angle) * 1.035, Math.sin(angle) * 1.035, 0.35),
      quatZ(0),
    ),
  );

  const clampGeometry = new THREE.TorusGeometry(0.05, 0.012, 6, 14);
  const clampMatrices: THREE.Matrix4[] = [];
  for (const angle of PIPE_ANGLES) {
    for (const z of CLAMP_Z) {
      clampMatrices.push(
        matrixAt(new THREE.Vector3(Math.cos(angle) * 1.035, Math.sin(angle) * 1.035, z), quatZ(0)),
      );
    }
  }

  const finGeometry = new THREE.BoxGeometry(0.06, 0.024, 1.4);
  const finMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < FIN_COUNT; i += 1) {
    const angle = THREE.MathUtils.degToRad(26 + (i / (FIN_COUNT - 1)) * 128);
    finMatrices.push(
      matrixAt(new THREE.Vector3(Math.cos(angle) * 1.0, Math.sin(angle) * 1.0, 0.15), quatZ(angle)),
    );
  }

  // Ceramic nozzle petals + darker heat-stained petals underneath.
  const petalGeometry = new THREE.BoxGeometry(0.055, 0.3, 0.52);
  const petalMatrices: THREE.Matrix4[] = [];
  const underPetalGeometry = new THREE.BoxGeometry(0.04, 0.34, 0.56);
  const underPetalMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < PETAL_COUNT; i += 1) {
    const angle = (i / PETAL_COUNT) * TAU + 0.06;
    const radial = new THREE.Vector3(Math.cos(angle) * 0.745, Math.sin(angle) * 0.745, -2.045);
    const underRadial = new THREE.Vector3(Math.cos(angle) * 0.705, Math.sin(angle) * 0.705, -2.02);
    const flare = quatZ(angle).multiply(quatY(-0.22));
    const underFlare = quatZ(angle).multiply(quatY(-0.2));
    petalMatrices.push(matrixAt(radial, flare));
    underPetalMatrices.push(matrixAt(underRadial, underFlare));
  }

  const nozzleRimGeometry = new THREE.TorusGeometry(0.8, 0.014, 8, 48);
  const nozzleBackplateGeometry = new THREE.RingGeometry(0.48, 0.83, 40);

  const innerNozzleGeometry = new THREE.CylinderGeometry(0.62, 0.5, 0.84, 40, 6, true);
  innerNozzleGeometry.rotateX(Math.PI / 2);

  const throatGeometry = new THREE.TorusGeometry(0.45, 0.016, 8, 40);

  const plugGeometry = new THREE.ConeGeometry(0.24, 0.56, 24, 1, false);
  plugGeometry.rotateX(-Math.PI / 2);

  const decalPlateGeometry = new THREE.BoxGeometry(0.03, 0.3, 0.64);
  const decalPlaneGeometry = new THREE.PlaneGeometry(0.56, 0.24);

  const pylonGeometry = new THREE.BoxGeometry(0.95, 0.15, 0.6);
  const pylonStrutGeometry = new THREE.CylinderGeometry(0.032, 0.032, 0.9, 8);
  pylonStrutGeometry.rotateZ(Math.PI / 2);
  const pylonAccentGeometry = new THREE.BoxGeometry(0.9, 0.012, 0.05);

  const blisterGeometry = new THREE.SphereGeometry(0.085, 12, 8);
  const lensDotGeometry = new THREE.SphereGeometry(0.026, 8, 6);
  const greebleGeometry = new THREE.BoxGeometry(1, 1, 1);

  engineAssets = {
    sections,
    seamRings,
    heatShellMaterial,
    glowMaterial,
    nozzleInnerMaterial,
    petalDarkMaterial,
    lensMaterial,
    decalMaterial,
    linerMaterial,
    lipGeometry,
    accentRingGeometry,
    intakeLinerGeometry,
    intakeGlowGeometry,
    fanDiscGeometry,
    fanHubGeometry,
    bladeGeometry,
    vaneGeometry,
    fanBladeMatrices,
    vaneMatrices,
    actuatorRings,
    pistonBodyGeometry,
    pistonRodGeometry,
    bracketGeometry,
    pistonMatrices,
    bracketMatrices,
    pipeGeometry,
    pipeMatrices,
    clampGeometry,
    clampMatrices,
    finGeometry,
    finMatrices,
    petalGeometry,
    petalMatrices,
    underPetalGeometry,
    underPetalMatrices,
    nozzleRimGeometry,
    nozzleBackplateGeometry,
    innerNozzleGeometry,
    throatGeometry,
    plugGeometry,
    decalPlateGeometry,
    decalPlaneGeometry,
    pylonGeometry,
    pylonStrutGeometry,
    pylonAccentGeometry,
    blisterGeometry,
    lensDotGeometry,
    greebleGeometry,
  };

  return engineAssets;
}

function getEngineAssets() {
  return engineAssets ?? buildEngineAssets();
}

interface GreebleMatrices {
  dark: THREE.Matrix4[];
  trim: THREE.Matrix4[];
}

function buildGreebles(side: 'L' | 'R'): GreebleMatrices {
  const random = makeRandom(side === 'L' ? 1337 : 7907);
  const dark: THREE.Matrix4[] = [];
  const trim: THREE.Matrix4[] = [];
  const outerAngle = side === 'R' ? 0 : Math.PI;
  let guard = 0;

  while (dark.length + trim.length < 24 && guard < 400) {
    guard += 1;
    const z = 2.0 - random() * 3.7;
    const angle = random() * TAU;
    const rawDiff = Math.atan2(Math.sin(angle - outerAngle), Math.cos(angle - outerAngle));
    // Keep the nameplate area clear.
    if (Math.abs(rawDiff) < 0.24 && z > 0.58 && z < 1.34) continue;

    const thickness = 0.035 + random() * 0.05;
    const width = 0.06 + random() * 0.13;
    const depth = 0.1 + random() * 0.28;
    const radius = radiusAt(z) + thickness * 0.3;
    const matrix = matrixAt(
      new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z),
      quatZ(angle),
      new THREE.Vector3(thickness, width, depth),
    );

    if (random() > 0.36) dark.push(matrix);
    else trim.push(matrix);
  }

  return { dark, trim };
}

function useInstanceMatrices(matrices: THREE.Matrix4[]) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    for (let i = 0; i < matrices.length; i += 1) node.setMatrixAt(i, matrices[i]);
    node.instanceMatrix.needsUpdate = true;
    node.computeBoundingSphere();
  }, [matrices]);
  return ref;
}

export function Engine({ side }: { side: 'L' | 'R' }) {
  const mats = useShipMaterials();
  const assets = getEngineAssets();
  const { power, reducedMotion } = useShip();

  const outer = side === 'R' ? 1 : -1;
  const inner = -outer;
  const x = side === 'R' ? 3.0 : -3.0;

  const greebles = useMemo(() => buildGreebles(side), [side]);

  const fanRef = useInstanceMatrices(assets.fanBladeMatrices);
  const vaneRef = useInstanceMatrices(assets.vaneMatrices);
  const finRef = useInstanceMatrices(assets.finMatrices);
  const petalRef = useInstanceMatrices(assets.petalMatrices);
  const underPetalRef = useInstanceMatrices(assets.underPetalMatrices);
  const clampRef = useInstanceMatrices(assets.clampMatrices);
  const greebleDarkRef = useInstanceMatrices(greebles.dark);
  const greebleTrimRef = useInstanceMatrices(greebles.trim);

  const powerRef = useRef(0);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const target = power === 'ignition' ? 1 : 0;
    powerRef.current = THREE.MathUtils.damp(
      powerRef.current,
      target,
      reducedMotion ? 10 : 3.4,
      delta,
    );
    const p = powerRef.current;
    const time = state.clock.elapsedTime;
    const pulse = reducedMotion
      ? 1
      : 0.94 + 0.06 * Math.sin(time * 7.7 + (side === 'L' ? 0.4 : 2.1));

    assets.glowMaterial.emissiveIntensity = (1.1 + p * 4.8) * pulse;
    assets.nozzleInnerMaterial.emissiveIntensity = 0.1 + p * 1.6;
    assets.petalDarkMaterial.emissiveIntensity = 0.05 + p * 0.85;
    assets.heatShellMaterial.emissiveIntensity = 0.035 + p * 0.3;
    assets.lensMaterial.emissiveIntensity = 0.7 + p * 1.4;

    if (fanRef.current && !reducedMotion) {
      fanRef.current.rotation.z += delta * (0.45 + p * 2.6);
    }
  });

  return (
    <>
      <group position={[x, -0.05, -4.55]} name={`vector9-${side}`}>
        {/* --- Pressure shell ------------------------------------------------ */}
        {assets.sections.map((section, index) => (
          <mesh
            key={`section-${index}`}
            geometry={section.geometry}
            material={section.heat ? assets.heatShellMaterial : mats.hull}
            position={[0, 0, section.z]}
            castShadow
            receiveShadow
          />
        ))}

        {assets.seamRings.map((ring, index) => (
          <mesh
            key={`seam-${index}`}
            geometry={ring.geometry}
            material={mats.dark}
            position={[0, 0, ring.z]}
          />
        ))}

        <mesh
          geometry={assets.accentRingGeometry}
          material={mats.accent}
          position={[0, 0, 1.86]}
        />

        {/* --- Circular intake ---------------------------------------------- */}
        <mesh geometry={assets.lipGeometry} material={mats.ceramic} position={[0, 0, 2.28]} />
        <mesh
          geometry={assets.intakeLinerGeometry}
          material={assets.linerMaterial}
          position={[0, 0, 1.94]}
        />
        <mesh
          geometry={assets.intakeGlowGeometry}
          material={assets.glowMaterial}
          position={[0, 0, 2.0]}
        />
        <mesh geometry={assets.fanDiscGeometry} material={mats.black} position={[0, 0, 1.51]} />
        <mesh
          geometry={assets.fanHubGeometry}
          material={mats.trim}
          position={[0, 0, 1.62]}
        />
        <instancedMesh
          ref={fanRef}
          args={[assets.bladeGeometry, mats.dark, BLADE_COUNT]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={vaneRef}
          args={[assets.vaneGeometry, mats.trim, VANE_COUNT]}
          frustumCulled={false}
        />

        {/* --- Actuator rings, pistons, bypass plumbing --------------------- */}
        {assets.actuatorRings.map((ring, index) => (
          <mesh
            key={`actuator-${index}`}
            geometry={ring.geometry}
            material={mats.trim}
            position={[0, 0, ring.z]}
          />
        ))}

        {assets.pistonMatrices.map((piston, index) => (
          <group key={`piston-${index}`}>
            <mesh geometry={assets.pistonBodyGeometry} material={mats.dark} matrixAutoUpdate={false} matrix={piston.body} />
            <mesh geometry={assets.pistonRodGeometry} material={mats.trim} matrixAutoUpdate={false} matrix={piston.rod} />
          </group>
        ))}
        {assets.bracketMatrices.map((bracket, index) => (
          <mesh
            key={`bracket-${index}`}
            geometry={assets.bracketGeometry}
            material={mats.dark}
            matrixAutoUpdate={false}
            matrix={bracket}
          />
        ))}

        {assets.pipeMatrices.map((pipe, index) => (
          <mesh
            key={`pipe-${index}`}
            geometry={assets.pipeGeometry}
            material={mats.trim}
            matrixAutoUpdate={false}
            matrix={pipe}
          />
        ))}
        <instancedMesh
          ref={clampRef}
          args={[assets.clampGeometry, mats.dark, assets.clampMatrices.length]}
          frustumCulled={false}
        />

        {/* --- Heat exchanger fins / greebles ------------------------------- */}
        <instancedMesh
          ref={finRef}
          args={[assets.finGeometry, mats.dark, FIN_COUNT]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={greebleDarkRef}
          args={[assets.greebleGeometry, mats.dark, greebles.dark.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={greebleTrimRef}
          args={[assets.greebleGeometry, mats.trim, greebles.trim.length]}
          frustumCulled={false}
        />

        {/* --- Nameplate ---------------------------------------------------- */}
        <mesh
          geometry={assets.decalPlateGeometry}
          material={mats.dark}
          position={[outer * 0.984, 0.04, 0.95]}
        />
        <mesh
          geometry={assets.decalPlaneGeometry}
          material={assets.decalMaterial}
          position={[outer * 1.0025, 0.04, 0.95]}
          rotation={[0, outer > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
        />

        {/* --- Sensors ------------------------------------------------------ */}
        <mesh
          geometry={assets.blisterGeometry}
          material={mats.dark}
          position={[0, radiusAt(0.9) + 0.03, 0.9]}
          scale={[1.6, 0.75, 2.2]}
        />
        <mesh
          geometry={assets.lensDotGeometry}
          material={assets.lensMaterial}
          position={[0, radiusAt(0.9) + 0.085, 0.92]}
        />
        <mesh
          geometry={assets.blisterGeometry}
          material={mats.dark}
          position={[0, radiusAt(-0.35) + 0.03, -0.35]}
          scale={[1.4, 0.7, 1.9]}
        />
        <mesh
          geometry={assets.lensDotGeometry}
          material={assets.lensMaterial}
          position={[0, radiusAt(-0.35) + 0.08, -0.33]}
        />

        {/* --- Mounting pylon ----------------------------------------------- */}
        <mesh
          geometry={assets.pylonGeometry}
          material={mats.dark}
          position={[inner * 1.235, 0.02, 0.12]}
          castShadow
        />
        <mesh
          geometry={assets.pylonStrutGeometry}
          material={mats.trim}
          position={[inner * 1.2, 0.18, 0.38]}
        />
        <mesh
          geometry={assets.pylonStrutGeometry}
          material={mats.trim}
          position={[inner * 1.2, -0.14, 0.38]}
        />
        <mesh
          geometry={assets.pylonAccentGeometry}
          material={mats.accent}
          position={[inner * 1.2, 0.095, 0.34]}
        />

        {/* --- Ceramic nozzle petals / heat-stained interior ----------------- */}
        <instancedMesh
          ref={underPetalRef}
          args={[assets.underPetalGeometry, assets.petalDarkMaterial, PETAL_COUNT]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={petalRef}
          args={[assets.petalGeometry, mats.ceramic, PETAL_COUNT]}
          frustumCulled={false}
        />
        <mesh
          geometry={assets.nozzleRimGeometry}
          material={mats.ceramic}
          position={[0, 0, -2.3]}
        />
        <mesh
          geometry={assets.nozzleBackplateGeometry}
          material={assets.petalDarkMaterial}
          position={[0, 0, -2.26]}
          rotation={[0, Math.PI, 0]}
        />
        <mesh
          geometry={assets.innerNozzleGeometry}
          material={assets.nozzleInnerMaterial}
          position={[0, 0, -1.88]}
        />
        <mesh
          geometry={assets.throatGeometry}
          material={assets.glowMaterial}
          position={[0, 0, -1.9]}
        />
        <mesh
          geometry={assets.plugGeometry}
          material={assets.petalDarkMaterial}
          position={[0, 0, -2.02]}
        />
      </group>

      <PlasmaPlume side={side} />
    </>
  );
}
