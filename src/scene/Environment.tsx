import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ContactShadows,
  Environment as DreiEnvironment,
  Lightformer,
  MeshReflectorMaterial,
  Sparkles,
  Stars,
} from '@react-three/drei';
import { useShip } from '../state/ship';

/**
 * HELIOS-9 environment.
 *
 * A dark orbital presentation bay:
 * - reflective circular drydock deck at y = -4.2 with procedural markings
 * - deep-space gradient dome, three star layers, faint planet limb
 * - distant gantry silhouettes swallowed by fog
 * - cool key spot + cyan rim + diegetic warm engine bounce
 * - low-additive volumetric cones and drifting dust
 *
 * Everything is procedural. No external HDRI / network assets.
 */

const DECK_Y = -4.2;
const DECK_RADIUS = 19.2;

/* Stable array references: drei components memoize on prop identity, and the
 * environment re-renders whenever ship state changes (hover/selection). */
const DECK_BLUR: [number, number] = [116, 42];
const DUST_SCALE: [number, number, number] = [32, 9, 32];

const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------------ */
/* procedural textures                                                      */
/* ------------------------------------------------------------------------ */

function createRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function createDeckTexture(): THREE.CanvasTexture {
  const SIZE = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const half = SIZE / 2;
  const rOf = (meters: number) => (meters / DECK_RADIUS) * half;
  const random = createRandom(4113);

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.translate(half, half);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  /* subtle worn paint / oxidation patina */
  for (let i = 0; i < 120; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * rOf(18.5);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    ctx.fillStyle = `rgba(198, 219, 226, ${0.012 + random() * 0.02})`;
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      rOf(0.18 + random() * 1.6),
      rOf(0.08 + random() * 0.8),
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  /* deck plate seams radiating outward */
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2 + 0.09;
    ctx.strokeStyle = 'rgba(8, 12, 16, 0.5)';
    ctx.lineWidth = Math.max(2, rOf(0.055));
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * rOf(4.9), Math.sin(angle) * rOf(4.9));
    ctx.lineTo(Math.cos(angle) * rOf(18.95), Math.sin(angle) * rOf(18.95));
    ctx.stroke();

    ctx.strokeStyle = 'rgba(170, 196, 204, 0.055)';
    ctx.lineWidth = Math.max(1, rOf(0.025));
    const offset = rOf(0.06);
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * rOf(4.9) + offset, Math.sin(angle) * rOf(4.9) + offset);
    ctx.lineTo(Math.cos(angle) * rOf(18.95) + offset, Math.sin(angle) * rOf(18.95) + offset);
    ctx.stroke();
  }

  /* concentric technical rings */
  const ring = (
    meters: number,
    widthPx: number,
    color: string,
    dash: number[] = [],
    start = 0,
    end = Math.PI * 2,
  ) => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx;
    ctx.beginPath();
    ctx.arc(0, 0, rOf(meters), start, end);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  ring(2.1, 3, 'rgba(178, 204, 212, 0.24)');
  ring(3.55, 2, 'rgba(150, 184, 194, 0.18)', [10, 12]);
  ring(5.1, 3, 'rgba(150, 184, 194, 0.2)');
  ring(6.35, 4, 'rgba(95, 231, 242, 0.34)');
  ring(6.6, 2, 'rgba(196, 222, 230, 0.18)');
  ring(8.3, 2, 'rgba(150, 184, 194, 0.14)', [8, 14]);
  ring(9.55, 3, 'rgba(160, 192, 200, 0.22)');
  ring(11.3, 2, 'rgba(140, 176, 186, 0.15)', [18, 12]);
  ring(12.45, 3, 'rgba(168, 198, 206, 0.22)');
  ring(13.2, 2, 'rgba(118, 152, 162, 0.3)');
  ring(15.0, 2, 'rgba(118, 152, 162, 0.3)');
  ring(15.35, 4, 'rgba(95, 231, 242, 0.3)');
  ring(15.62, 2, 'rgba(196, 222, 230, 0.16)');
  ring(17.9, 3, 'rgba(176, 202, 210, 0.24)');
  ring(18.88, 3, 'rgba(95, 231, 242, 0.24)', [34, 22]);
  ring(1.15, 6, 'rgba(95, 231, 242, 0.4)', [2, 8]);

  /* walkway grating texture band */
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, rOf(15.0), 0, Math.PI * 2);
  ctx.arc(0, 0, rOf(13.2), 0, Math.PI * 2, true);
  ctx.clip('evenodd');
  for (let i = 0; i < 320; i += 1) {
    const angle = (i / 320) * Math.PI * 2;
    const edge = Math.cos(angle * 2) > 0;
    ctx.strokeStyle = edge ? 'rgba(7, 11, 15, 0.6)' : 'rgba(186, 208, 216, 0.07)';
    ctx.lineWidth = Math.max(1, rOf(0.026));
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * rOf(13.2), Math.sin(angle) * rOf(13.2));
    ctx.lineTo(Math.cos(angle) * rOf(15.0), Math.sin(angle) * rOf(15.0));
    ctx.stroke();
  }
  ctx.restore();

  /* radial tick ring */
  for (let deg = 0; deg < 360; deg += 2.5) {
    const angle = (deg * Math.PI) / 180;
    const major = deg % 30 === 0;
    const medium = deg % 10 === 0;
    const inner = major ? 17.95 : medium ? 18.2 : 18.38;
    ctx.strokeStyle = major
      ? 'rgba(95, 231, 242, 0.48)'
      : medium
        ? 'rgba(178, 204, 212, 0.3)'
        : 'rgba(150, 180, 190, 0.2)';
    ctx.lineWidth = major ? 4 : medium ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * rOf(inner), Math.sin(angle) * rOf(inner));
    ctx.lineTo(Math.cos(angle) * rOf(18.72), Math.sin(angle) * rOf(18.72));
    ctx.stroke();
  }

  /* hazard chevrons pointing at the bay center */
  ctx.strokeStyle = 'rgba(198, 158, 84, 0.5)';
  ctx.lineWidth = Math.max(2, rOf(0.14));
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    ctx.save();
    ctx.translate(Math.cos(angle) * rOf(17.2), Math.sin(angle) * rOf(17.2));
    ctx.rotate(angle + Math.PI);
    for (let k = 0; k < 2; k += 1) {
      const offset = (k - 0.5) * rOf(0.52);
      ctx.beginPath();
      ctx.moveTo(offset, -rOf(0.42));
      ctx.lineTo(offset + rOf(0.46), 0);
      ctx.lineTo(offset, rOf(0.42));
      ctx.stroke();
    }
    ctx.restore();
  }

  /* center reticle */
  ctx.strokeStyle = 'rgba(95, 231, 242, 0.34)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-rOf(2.0), 0);
  ctx.lineTo(-rOf(0.9), 0);
  ctx.moveTo(rOf(0.9), 0);
  ctx.lineTo(rOf(2.0), 0);
  ctx.moveTo(0, -rOf(2.0));
  ctx.lineTo(0, -rOf(0.9));
  ctx.moveTo(0, rOf(0.9));
  ctx.lineTo(0, rOf(2.0));
  ctx.stroke();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    ctx.beginPath();
    ctx.arc(0, 0, rOf(2.9), angle, angle + 0.35);
    ctx.stroke();
  }

  /* radial compass numbers */
  ctx.font = '700 26px "Arial Narrow", Bahnschrift, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const value = `${i * 30}`.padStart(3, '0');
    ctx.fillStyle = i % 3 === 0 ? 'rgba(95, 231, 242, 0.4)' : 'rgba(170, 198, 206, 0.26)';
    ctx.save();
    ctx.translate(Math.cos(angle) * rOf(16.55), Math.sin(angle) * rOf(16.55));
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillText(value, 0, 0);
    ctx.restore();
  }

  /* deck stencils, laid out in deck-local meters (canvas +y = world -Z) */
  const stencil = (
    text: string,
    xMeters: number,
    yMeters: number,
    sizePx: number,
    alpha: number,
    rotation = 0,
    weight = 700,
  ) => {
    ctx.save();
    ctx.fillStyle = `rgba(206, 225, 231, ${alpha})`;
    ctx.font = `${weight} ${sizePx}px "Arial Narrow", Bahnschrift, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(rOf(xMeters), rOf(yMeters));
    ctx.rotate(rotation);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };

  /* canvas +y points to the nose, so text stays upright for the hero camera */
  stencil('HELIOS-9', 0, 10.7, 78, 0.24, 0);
  stencil('CORONA-CLASS INTERCEPTOR', 0, 11.9, 28, 0.18, 0);
  stencil('ORBITAL DRYDOCK 07', 0, -10.7, 62, 0.17, 0);
  stencil('PRESENTATION BAY 03', 0, -11.75, 28, 0.16, 0);
  stencil('CLEARANCE 19.2 M', -13.35, 0, 28, 0.16, -Math.PI / 2);
  stencil('SERVICE RING A', 13.35, 0, 28, 0.16, Math.PI / 2);

  /* paint chips and abrasion */
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 320; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * rOf(18.9);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.12 + random() * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      rOf(0.02 + random() * 0.16),
      rOf(0.02 + random() * 0.1),
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.lineWidth = 2;
  for (let i = 0; i < 90; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * rOf(18.6);
    ctx.strokeStyle = `rgba(0, 0, 0, ${0.1 + random() * 0.35})`;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    ctx.lineTo(
      Math.cos(angle) * radius + (random() - 0.5) * rOf(0.8),
      Math.sin(angle) * radius + (random() - 0.5) * rOf(0.8),
    );
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function createDeckRoughnessTexture(): THREE.CanvasTexture {
  const SIZE = 512;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const random = createRandom(90210);

  ctx.fillStyle = '#c4c4c4';
  ctx.fillRect(0, 0, SIZE, SIZE);

  /* darker = wetter / smoother. Soft blotches create a patchy sheen. */
  for (let i = 0; i < 52; i += 1) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    const radius = 18 + random() * 92;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(48, 48, 48, ${0.3 + random() * 0.45})`);
    gradient.addColorStop(0.7, `rgba(96, 96, 96, ${0.14 + random() * 0.2})`);
    gradient.addColorStop(1, 'rgba(120, 120, 120, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /* faint directional wiping marks */
  for (let i = 0; i < 90; i += 1) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.03 + random() * 0.06})`;
    ctx.lineWidth = 1 + random() * 3;
    const x = random() * SIZE;
    const y = random() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 20 + random() * 90, y + (random() - 0.5) * 14);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.6, 2.6);
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------------ */
/* deep-space backdrop                                                      */
/* ------------------------------------------------------------------------ */

const NOISE_GLSL = `
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}
`;

const BACKDROP_VERTEX = `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BACKDROP_FRAGMENT = `
varying vec3 vDir;

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uBandDir;
uniform vec3 uPlanetDir;

${NOISE_GLSL}

void main() {
  float height = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 color = mix(uHorizon, uZenith, smoothstep(0.48, 0.98, height));

  float band = exp(-pow(dot(vDir, uBandDir) * 2.1, 2.0));
  float clouds = valueNoise(vDir * 4.2) * 0.62 + valueNoise(vDir * 9.1) * 0.38;
  color += uGlow * band * (0.18 + 0.82 * clouds) * 0.32;

  float halo = pow(max(dot(vDir, uPlanetDir), 0.0), 9.0);
  color += uGlow * halo * 0.4;

  color += (hash31(vDir * 517.0) - 0.5) * 0.0018;
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

function SpaceBackdrop() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: new THREE.Color('#02060d') },
          uHorizon: { value: new THREE.Color('#07141f') },
          uGlow: { value: new THREE.Color('#1d4e5a') },
          uBandDir: { value: new THREE.Vector3(0.32, 0.66, -0.68).normalize() },
          uPlanetDir: { value: new THREE.Vector3(-120.4, -54.7, -53.5).normalize() },
        },
        vertexShader: BACKDROP_VERTEX,
        fragmentShader: BACKDROP_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );

  return (
    <mesh material={material} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[185, 48, 32]} />
    </mesh>
  );
}

/* ------------------------------------------------------------------------ */
/* planet limb                                                              */
/* ------------------------------------------------------------------------ */

const PLANET_VERTEX = `
varying vec3 vNormalW;
varying vec3 vWorldPos;

void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const PLANET_FRAGMENT = `
varying vec3 vNormalW;
varying vec3 vWorldPos;

uniform vec3 uRim;
uniform vec3 uLightDir;

void main() {
  vec3 normal = normalize(vNormalW);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float light = clamp(dot(normal, uLightDir), 0.0, 1.0);

  vec3 base = mix(vec3(0.0016, 0.0045, 0.0070), vec3(0.0075, 0.0210, 0.0265), smoothstep(-0.75, 0.95, normal.y));
  float bands = 0.5 + 0.5 * sin(normal.y * 21.0 + normal.x * 3.0);
  base *= 0.78 + 0.34 * bands;
  base *= 0.32 + 0.95 * light;

  float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  base += uRim * rim * (0.22 + 0.9 * light);

  gl_FragColor = vec4(base, 1.0);
}
`;

const ATMOSPHERE_VERTEX = `
varying vec3 vNormalW;
varying vec3 vWorldPos;

void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const ATMOSPHERE_FRAGMENT = `
varying vec3 vNormalW;
varying vec3 vWorldPos;

uniform vec3 uColor;
uniform float uIntensity;
uniform float uPower;

void main() {
  vec3 normal = normalize(vNormalW);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), uPower);
  float alpha = fresnel * uIntensity;
  gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 1.0));
}
`;

function PlanetLimb() {
  const center = useMemo(() => new THREE.Vector3(-120.4, -54.7, -53.5), []);
  const radius = 30;

  const surfaceMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uRim: { value: new THREE.Color('#6ecfdd') },
          uLightDir: { value: new THREE.Vector3(0.42, 0.78, 0.46).normalize() },
        },
        vertexShader: PLANET_VERTEX,
        fragmentShader: PLANET_FRAGMENT,
        fog: false,
      }),
    [],
  );

  const innerAtmosphere = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color('#64d6e4') },
          uIntensity: { value: 0.33 },
          uPower: { value: 3.4 },
        },
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        fog: false,
      }),
    [],
  );

  const outerAtmosphere = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color('#3f9fb4') },
          uIntensity: { value: 0.085 },
          uPower: { value: 1.7 },
        },
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        fog: false,
      }),
    [],
  );

  return (
    <group position={center}>
      <mesh material={surfaceMaterial} renderOrder={-90} frustumCulled={false}>
        <sphereGeometry args={[radius, 64, 48]} />
      </mesh>
      <mesh material={innerAtmosphere} renderOrder={-80} frustumCulled={false}>
        <sphereGeometry args={[radius * 1.018, 64, 48]} />
      </mesh>
      <mesh material={outerAtmosphere} renderOrder={-79} frustumCulled={false}>
        <sphereGeometry args={[radius * 1.06, 48, 32]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------------ */
/* stars                                                                    */
/* ------------------------------------------------------------------------ */

function StarLayers() {
  const { reducedMotion } = useShip();
  return (
    <>
      <Stars
        radius={118}
        depth={38}
        count={1400}
        factor={2.6}
        saturation={0.08}
        fade
        speed={reducedMotion ? 0 : 0.11}
      />
      <Stars
        radius={86}
        depth={26}
        count={440}
        factor={4.2}
        saturation={0.24}
        fade
        speed={reducedMotion ? 0 : 0.2}
      />
      <Stars
        radius={62}
        depth={16}
        count={130}
        factor={6.2}
        saturation={0.35}
        fade
        speed={reducedMotion ? 0 : 0.32}
      />
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* drydock deck                                                             */
/* ------------------------------------------------------------------------ */

type InstancedData = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
};

function InstancedParts({ data }: { data: InstancedData }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < data.matrices.length; i += 1) {
      mesh.setMatrixAt(i, data.matrices[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [data]);

  return (
    <instancedMesh
      ref={ref}
      args={[data.geometry, data.material, data.matrices.length]}
      frustumCulled
    />
  );
}

function buildGratingSlats(): InstancedData {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: '#1b242c',
    metalness: 0.78,
    roughness: 0.46,
    envMapIntensity: 0.7,
  });
  const matrices: THREE.Matrix4[] = [];
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(0.62, 0.05, 1.3);
  const count = 72;

  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    position.set(Math.cos(angle) * 14.1, 0.045, Math.sin(angle) * 14.1);
    quaternion.setFromAxisAngle(UP, -angle - Math.PI / 2);
    matrices.push(new THREE.Matrix4().compose(position, quaternion, scale));
  }

  return { geometry, material, matrices };
}

function DeckGrating() {
  const data = useMemo(buildGratingSlats, []);
  return <InstancedParts data={data} />;
}

/* ------------------------------------------------------------------------ */
/* bay outer structure + gantry silhouettes                                 */
/* ------------------------------------------------------------------------ */

/* Gantry framing. Angles are chosen so the hero camera looks through a pair of
 * dark service towers while a third layer of station towers fades into fog. */
type TowerSpec = {
  angle: number;
  radius: number;
  height: number;
  width: number;
  arm: boolean;
  foundation: number;
};

const TOWER_SPECS: TowerSpec[] = [
  { angle: 3.42, radius: 27.5, height: 13.5, width: 2.6, arm: true, foundation: 9 },
  { angle: 4.28, radius: 30.5, height: 14.8, width: 2.8, arm: true, foundation: 9 },
  { angle: 2.6, radius: 28.8, height: 11.4, width: 2.2, arm: false, foundation: 9 },
  { angle: 5.15, radius: 26.8, height: 12.2, width: 2.4, arm: false, foundation: 9 },
  { angle: 4.05, radius: 62, height: 34, width: 7.5, arm: false, foundation: 30 },
  { angle: 2.85, radius: 74, height: 40, width: 9.0, arm: false, foundation: 36 },
  { angle: 5.45, radius: 58, height: 30, width: 6.0, arm: false, foundation: 28 },
];

function buildGantries(): InstancedData {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: '#070b10',
    metalness: 0.55,
    roughness: 0.8,
    envMapIntensity: 0.22,
  });

  const matrices: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  const pushBeam = (
    from: THREE.Vector3,
    to: THREE.Vector3,
    thickness: number,
  ) => {
    dir.subVectors(to, from);
    const length = dir.length();
    if (length < 0.001) return;
    mid.addVectors(from, to).multiplyScalar(0.5);
    quaternion.setFromUnitVectors(up, dir.normalize());
    scale.set(thickness, length, thickness);
    matrices.push(new THREE.Matrix4().compose(mid, quaternion, scale));
  };

  const tower = (
    angle: number,
    radius: number,
    height: number,
    width: number,
    withArm: boolean,
    foundation: number,
  ) => {
    const baseY = DECK_Y - 0.25;
    const originX = Math.cos(angle) * radius;
    const originZ = Math.sin(angle) * radius;
    const localToWorld = (x: number, y: number, z: number) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return new THREE.Vector3(
        originX + x * cos - z * sin,
        baseY + y,
        originZ + x * sin + z * cos,
      );
    };

    const halfW = width / 2;
    const corners: [number, number][] = [
      [-halfW, -halfW],
      [halfW, -halfW],
      [halfW, halfW],
      [-halfW, halfW],
    ];

    /* legs continue below the deck line so distant towers read as anchored */
    corners.forEach(([x, z]) => {
      pushBeam(localToWorld(x, -foundation, z), localToWorld(x, height, z), 0.3);
    });

    /* foundation cross frames */
    if (foundation > 0) {
      const foundationLevels = [-foundation + 3, -foundation * 0.55, -foundation * 0.18];
      foundationLevels.forEach((y) => {
        corners.forEach(([x, z], index) => {
          const next = corners[(index + 1) % 4];
          pushBeam(
            localToWorld(x, y, z),
            localToWorld(next[0], y, next[1]),
            0.2,
          );
        });
      });
    }

    /* horizontal frames */
    const levels = [2, 4.6, 7.2, 9.8, 12.4].filter((y) => y < height - 1);
    levels.forEach((y, levelIndex) => {
      corners.forEach(([x, z], index) => {
        const next = corners[(index + 1) % 4];
        pushBeam(
          localToWorld(x, y, z),
          localToWorld(next[0], y, next[1]),
          0.17,
        );
      });

      /* alternating diagonal bracing */
      if (levelIndex < levels.length) {
        corners.forEach(([x, z], index) => {
          const next = corners[(index + 1) % 4];
          const flip = (index + levelIndex) % 2 === 0;
          const fromY = flip ? y : levels[levelIndex - 1] ?? 0;
          const toY = flip ? levels[levelIndex - 1] ?? 0 : y;
          if (levelIndex === 0 && !flip) return;
          pushBeam(localToWorld(x, fromY, z), localToWorld(next[0], toY, next[1]), 0.12);
        });
      }
    });

    /* base plate + top cap */
    pushBeam(
      localToWorld(-halfW - 0.8, 0.18, -halfW - 0.8),
      localToWorld(halfW + 0.8, 0.18, halfW + 0.8),
      0.3,
    );
    pushBeam(
      localToWorld(-halfW, height, -halfW),
      localToWorld(halfW, height, halfW),
      0.3,
    );

    /* service arm reaching inward, kept outside the deck radius */
    if (withArm) {
      const armLength = Math.min(6.2, radius - DECK_RADIUS - 1.2);
      if (armLength > 1.4) {
        const tipRadius = radius - armLength;
        const tipX = Math.cos(angle) * tipRadius;
        const tipZ = Math.sin(angle) * tipRadius;
        const armY = height - 0.9;
        const armStart = localToWorld(0, armY, 0);
        const armTip = new THREE.Vector3(tipX, baseY + armY, tipZ);
        pushBeam(armStart, armTip, 0.26);
        pushBeam(
          localToWorld(0, armY - 2.2, 0),
          new THREE.Vector3(tipX, baseY + armY - 1.4, tipZ),
          0.16,
        );
        pushBeam(
          localToWorld(0, armY - 2.2, 0),
          new THREE.Vector3(tipX, baseY + armY, tipZ),
          0.12,
        );
        /* hoist block */
        pushBeam(
          new THREE.Vector3(tipX, baseY + armY + 0.4, tipZ),
          new THREE.Vector3(tipX, baseY + armY - 1.4, tipZ),
          0.3,
        );
      }
    }
  };

  /* near gantries framing the bay, plus a far layer of station towers */
  TOWER_SPECS.forEach((spec) => {
    tower(spec.angle, spec.radius, spec.height, spec.width, spec.arm, spec.foundation);
  });

  return { geometry, material, matrices };
}

function GantryMarkers() {
  const data = useMemo(() => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const matrices: THREE.Matrix4[] = [];
    const colors: string[] = [];
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    const add = (x: number, y: number, z: number, size: number, color: string) => {
      position.set(x, y, z);
      scale.set(size, size, size);
      matrices.push(new THREE.Matrix4().compose(position, quaternion, scale));
      colors.push(color);
    };

    TOWER_SPECS.forEach(({ angle, radius, height }, towerIndex) => {
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const near = towerIndex < 4;
      add(x, DECK_Y + height + 0.35, z, near ? 0.34 : 0.5, near ? '#8a3f14' : '#301608');

      const cool = towerIndex % 2 === 0 ? '#134a52' : '#0d2f38';
      add(x, DECK_Y + height * 0.45, z, near ? 0.24 : 0.4, cool);
      if (near) {
        add(x, DECK_Y + 2.2, z, 0.2, '#123c44');
      }
    });

    return { geometry, material, matrices, colors };
  }, []);

  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const color = new THREE.Color();
    for (let i = 0; i < data.matrices.length; i += 1) {
      mesh.setMatrixAt(i, data.matrices[i]);
      color.set(data.colors[i]);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [data]);

  return (
    <instancedMesh
      ref={ref}
      args={[data.geometry, data.material, data.matrices.length]}
      frustumCulled
    />
  );
}

/* ------------------------------------------------------------------------ */
/* deck                                                                     */
/* ------------------------------------------------------------------------ */

function DrydockDeck() {
  const size = useThree((state) => state.size);
  const compact = size.width < 900;
  const markings = useMemo(createDeckTexture, []);
  const wetRoughness = useMemo(createDeckRoughnessTexture, []);

  const underStructure = useMemo(() => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: '#080c11',
      metalness: 0.5,
      roughness: 0.82,
      envMapIntensity: 0.2,
    });
    const matrices: THREE.Matrix4[] = [];
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(0.42, 1.4, 11.5);
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2;
      position.set(Math.cos(angle) * 13.4, -0.9, Math.sin(angle) * 13.4);
      quaternion.setFromAxisAngle(UP, -angle - Math.PI / 2);
      matrices.push(new THREE.Matrix4().compose(position, quaternion, scale));
    }
    return { geometry, material, matrices };
  }, []);

  return (
    <group position={[0, DECK_Y, 0]}>
      {/* main reflective plate */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[DECK_RADIUS, 128]} />
        <MeshReflectorMaterial
          resolution={compact ? 320 : 384}
          mirror={0.16}
          mixBlur={1.25}
          mixStrength={12}
          blur={DECK_BLUR}
          depthScale={0.9}
          minDepthThreshold={0.45}
          maxDepthThreshold={1.35}
          depthToBlurRatioBias={0.25}
          color="#151e26"
          metalness={0.5}
          roughness={0.68}
          roughnessMap={wetRoughness}
          envMapIntensity={0.45}
        />
      </mesh>

      {/* painted markings */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.012} renderOrder={2}>
        <circleGeometry args={[DECK_RADIUS - 0.03, 128]} />
        <meshBasicMaterial
          map={markings}
          color="#cfdadd"
          transparent
          depthWrite={false}
          opacity={0.82}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      {/* grating band slats */}
      <DeckGrating />

      {/* raised rims */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.03} receiveShadow>
        <ringGeometry args={[4.55, 4.86, 96]} />
        <meshStandardMaterial color="#1c262e" metalness={0.82} roughness={0.38} envMapIntensity={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03} receiveShadow>
        <ringGeometry args={[13.15, 13.35, 96]} />
        <meshStandardMaterial color="#1c262e" metalness={0.82} roughness={0.38} envMapIntensity={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03} receiveShadow>
        <ringGeometry args={[14.85, 15.05, 96]} />
        <meshStandardMaterial color="#1c262e" metalness={0.82} roughness={0.38} envMapIntensity={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03} receiveShadow>
        <ringGeometry args={[17.52, 17.74, 96]} />
        <meshStandardMaterial color="#1c262e" metalness={0.82} roughness={0.38} envMapIntensity={0.9} />
      </mesh>

      {/* thin guide light just inside the curb */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} renderOrder={1}>
        <ringGeometry args={[18.84, 18.9, 96]} />
        <meshBasicMaterial
          color="#2c7a86"
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* outer curb */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.12}>
        <torusGeometry args={[19.02, 0.13, 8, 96]} />
        <meshStandardMaterial color="#222c35" metalness={0.86} roughness={0.3} envMapIntensity={1} />
      </mesh>

      {/* skirt below the deck */}
      <mesh position-y={-0.85} receiveShadow={false}>
        <cylinderGeometry args={[19.15, 16.7, 1.7, 96, 1, true]} />
        <meshStandardMaterial
          color="#0a0f14"
          metalness={0.55}
          roughness={0.76}
          side={THREE.DoubleSide}
          envMapIntensity={0.25}
        />
      </mesh>

      {/* service ring beyond the deck */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.28} receiveShadow>
        <ringGeometry args={[20.5, 31.5, 96]} />
        <meshStandardMaterial color="#070b10" metalness={0.35} roughness={0.9} envMapIntensity={0.15} />
      </mesh>

      {/* under-deck support column */}
      <mesh position-y={-3.6}>
        <cylinderGeometry args={[6.2, 3.2, 7.4, 48, 1, true]} />
        <meshStandardMaterial
          color="#080c11"
          metalness={0.4}
          roughness={0.88}
          side={THREE.DoubleSide}
          envMapIntensity={0.12}
        />
      </mesh>

      <InstancedParts data={underStructure} />
    </group>
  );
}

/* ------------------------------------------------------------------------ */
/* lighting                                                                 */
/* ------------------------------------------------------------------------ */

const KEY_POSITION: [number, number, number] = [9.5, 15.5, 8.2];
const KEY_TARGET: [number, number, number] = [0, -3.9, 0];
const RIM_POSITION: [number, number, number] = [-10.5, 12.0, -9.5];
const RIM_TARGET: [number, number, number] = [0, -3.6, -0.8];

/* Volumetric shafts are deliberately decoupled from the actual lamps: they sit
 * behind the hero and fall toward the deck so they read as atmosphere rather
 * than as lit geometry crossing the frame. */
const KEY_CONE_POSITION: [number, number, number] = [7.2, 17.5, -4.5];
const KEY_CONE_TARGET: [number, number, number] = [0, -4.0, 0.6];
const RIM_CONE_POSITION: [number, number, number] = [-13.5, 14.5, -15.5];
const RIM_CONE_TARGET: [number, number, number] = [-1.5, -4.0, -1.5];

const CONE_VERTEX = `
uniform float uHeight;

varying float vHeight;
varying vec3 vNormalW;
varying vec3 vViewDir;

void main() {
  vHeight = clamp(position.y / uHeight + 1.0, 0.0, 1.0);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = cameraPosition - worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const CONE_FRAGMENT = `
varying float vHeight;
varying vec3 vNormalW;
varying vec3 vViewDir;

uniform vec3 uColor;
uniform float uIntensity;

void main() {
  float beam = smoothstep(0.0, 0.3, vHeight) * pow(vHeight, 0.72);
  vec3 normal = normalize(vNormalW);
  vec3 viewDir = normalize(vViewDir);
  float facing = abs(dot(normal, viewDir));
  /* fade the shell silhouette out; the densest part of the volume sits where
   * the cone surface faces the camera, so no hard cone edges show up */
  float soft = smoothstep(0.0, 0.82, facing);
  float alpha = clamp(beam * soft * uIntensity, 0.0, 1.0);
  vec3 tint = uColor * (0.82 + 0.38 * (1.0 - vHeight));
  gl_FragColor = vec4(tint, alpha);
}
`;

function LightCone({
  position,
  target,
  angle,
  color,
  intensity,
}: {
  position: [number, number, number];
  target: [number, number, number];
  angle: number;
  color: string;
  intensity: number;
}) {
  const { geometry, material, quaternion } = useMemo(() => {
    const from = new THREE.Vector3(...position);
    const to = new THREE.Vector3(...target);
    const direction = to.clone().sub(from);
    const height = direction.length();
    const radius = Math.tan(angle) * height;

    const geometry = new THREE.ConeGeometry(radius, height, 48, 1, true);
    geometry.translate(0, -height / 2, 0);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uIntensity: { value: intensity },
        uHeight: { value: height },
      },
      vertexShader: CONE_VERTEX,
      fragmentShader: CONE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });

    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      direction.normalize(),
    );

    return { geometry, material, quaternion };
  }, [position, target, angle, color, intensity]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      quaternion={quaternion}
      renderOrder={4}
    />
  );
}

function LightFixture({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <group position={position}>
      <mesh position-y={0.32}>
        <boxGeometry args={[1.25, 0.32, 1.25]} />
        <meshStandardMaterial color="#141d25" metalness={0.82} roughness={0.34} envMapIntensity={0.7} />
      </mesh>
      <mesh position-y={0.7}>
        <cylinderGeometry args={[0.055, 0.055, 0.6, 8]} />
        <meshStandardMaterial color="#1a242d" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position-y={-0.02} rotation-x={Math.PI / 2}>
        <ringGeometry args={[0.3, 0.52, 24]} />
        <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function EngineBounce() {
  const { power, reducedMotion } = useShip();
  const engine = useRef<THREE.PointLight>(null);
  const spill = useRef<THREE.PointLight>(null);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    const boost = power === 'ignition' ? 1.9 : 1;
    const flicker = reducedMotion
      ? 1
      : 0.93 + 0.05 * Math.sin(time * 8.3) + 0.02 * Math.sin(time * 21.7 + 1.3);

    if (engine.current) {
      engine.current.intensity = THREE.MathUtils.damp(
        engine.current.intensity,
        26 * boost * flicker,
        5,
        delta,
      );
    }
    if (spill.current) {
      spill.current.intensity = THREE.MathUtils.damp(
        spill.current.intensity,
        18 * boost * flicker,
        4,
        delta,
      );
    }
  });

  return (
    <>
      <pointLight
        ref={engine}
        position={[0, -0.4, -7.2]}
        color="#ff7a2d"
        intensity={26}
        distance={20}
        decay={2}
      />
      <pointLight
        ref={spill}
        position={[0, -2.7, -10.6]}
        color="#ff6a22"
        intensity={18}
        distance={24}
        decay={2}
      />
    </>
  );
}

function StageLights() {
  const keyShadow = useRef<THREE.SpotLight>(null);

  useLayoutEffect(() => {
    const light = keyShadow.current;
    if (!light) return;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.00035;
    light.shadow.normalBias = 0.035;
    light.shadow.camera.near = 4;
    light.shadow.camera.far = 46;
    light.shadow.camera.updateProjectionMatrix();
  }, []);

  return (
    <>
      <ambientLight intensity={0.11} color="#1b3142" />
      <hemisphereLight args={['#214256', '#101c26', 0.42]} />
      <directionalLight position={[-15, 6.5, 14]} intensity={0.78} color="#9dbdd2" />
      <directionalLight position={[16, 5, 18]} intensity={0.72} color="#a8c6da" />

      {/* cool key spot */}
      <spotLight
        ref={keyShadow}
        position={KEY_POSITION}
        angle={0.36}
        penumbra={0.92}
        intensity={1500}
        color="#dce9ff"
        decay={2}
        castShadow
      />

      {/* cyan rim from the shadow side */}
      <spotLight
        position={RIM_POSITION}
        angle={0.4}
        penumbra={1}
        intensity={280}
        color="#5fe7f2"
        decay={2}
      />

      <EngineBounce />
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* environment                                                              */
/* ------------------------------------------------------------------------ */

/* Volumetric cones and dust live on layer 1. The hero camera sees that layer,
 * while the reflector, contact-shadow and light-shadow cameras (layer 0 only)
 * ignore it, so soft additive volumes never print into shadow maps. */
function VolumetricsLayer({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);

  useLayoutEffect(() => {
    const node = group.current;
    if (!node) return;
    node.traverse((child) => child.layers.set(1));
    camera.layers.enable(1);
    return () => {
      camera.layers.disable(1);
    };
  }, [camera]);

  return <group ref={group}>{children}</group>;
}

export function Environment() {
  const size = useThree((state) => state.size);
  const { reducedMotion, exploded } = useShip();
  const compact = size.width < 900;

  /* The contact shadow is a static silhouette most of the time; rebuild it once
   * after the exploded view settles instead of paying a depth pass every frame. */
  const [shadowVersion, setShadowVersion] = useState(0);
  const shadowFirst = useRef(true);
  useEffect(() => {
    if (shadowFirst.current) {
      shadowFirst.current = false;
      return;
    }
    const timer = window.setTimeout(() => setShadowVersion((value) => value + 1), 2000);
    return () => window.clearTimeout(timer);
  }, [exploded]);

  return (
    <>
      <fogExp2 attach="fog" args={['#04080e', 0.0105]} />

      <StageLights />

      <DreiEnvironment
        resolution={compact ? 128 : 256}
        frames={1}
        background={false}
        environmentIntensity={1.28}
      >
        <color attach="background" args={['#02040a']} />
        <Lightformer
          form="rect"
          intensity={3.6}
          color="#d8e7ff"
          scale={[11, 6, 1]}
          position={[4.5, 10.5, 6.5]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={3.0}
          color="#eaf4ff"
          scale={[16, 2.6, 1]}
          position={[0, 13.5, -2.4]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={2.7}
          color="#5fe7f2"
          scale={[7.5, 3.4, 1]}
          position={[-12.5, 3.2, -9]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={1.8}
          color="#ff8a3d"
          scale={[10, 3, 1]}
          position={[0, -3.4, -13.5]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#9fc6e0"
          scale={[6.5, 5, 1]}
          position={[12.5, 2.0, 12.5]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="ring"
          intensity={1.9}
          color="#2a7f8c"
          scale={[8, 8, 1]}
          position={[0, 1.5, -19]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={0.2}
          color="#0b1520"
          scale={[26, 26, 1]}
          position={[0, -10, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      </DreiEnvironment>

      <SpaceBackdrop />
      <PlanetLimb />
      <StarLayers />

      <DrydockDeck />
      <GantryMarkers />
      <Gantries />

      <ContactShadows
        key={`contact-${shadowVersion}`}
        position={[0, -4.02, 0]}
        scale={30}
        opacity={0.56}
        blur={2.9}
        far={7.5}
        resolution={compact ? 256 : 384}
        color="#000308"
        frames={1}
        smooth
      />

      <VolumetricsLayer>
        <Sparkles
          count={compact ? 180 : 280}
          scale={DUST_SCALE}
          position={[0, 0.7, 0]}
          size={2.3}
          speed={reducedMotion ? 0 : 0.2}
          opacity={0.24}
          color="#b7dbe6"
          noise={0.9}
        />

        <LightCone
          position={KEY_CONE_POSITION}
          target={KEY_CONE_TARGET}
          angle={0.3}
          color="#cfe0ff"
          intensity={0.075}
        />
        <LightCone
          position={RIM_CONE_POSITION}
          target={RIM_CONE_TARGET}
          angle={0.36}
          color="#5fe7f2"
          intensity={0.05}
        />
      </VolumetricsLayer>

      <LightFixture position={KEY_CONE_POSITION} color="#dcecff" />
      <LightFixture position={RIM_CONE_POSITION} color="#5fe7f2" />
    </>
  );
}

function Gantries() {
  const data = useMemo(buildGantries, []);
  return <InstancedParts data={data} />;
}
