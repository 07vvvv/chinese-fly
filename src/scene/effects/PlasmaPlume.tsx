import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ENGINE_NOZZLES } from '../../data/ship';
import { useShip } from '../../state/ship';

/**
 * VECTOR-9 twin plasma exhaust.
 *
 * Four nested additive cones (haze / outer flame / inner flame / white-hot core)
 * share one procedural shader family. Everything is driven from uniforms and
 * refs; React never re-renders per frame. The idle "standby" flame is already
 * alive and the ignition state stretches + brightens it into afterburner.
 */

const TAU = Math.PI * 2;

const PLUME_NOISE = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
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

  float fbm3(vec3 p) {
    float sum = 0.0;
    float amp = 0.55;
    for (int i = 0; i < 3; i++) {
      sum += amp * noise3(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      amp *= 0.5;
    }
    return sum;
  }
`;

const PLUME_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewV;

  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewV = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PLUME_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform float uMotion;
  uniform float uSeed;
  uniform float uIntensity;
  uniform float uBand;
  uniform float uFlow;
  uniform float uEdge;
  uniform float uDim;
  uniform vec3 uHot;
  uniform vec3 uMid;
  uniform vec3 uCool;

  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewV;

  ${PLUME_NOISE}

  void main() {
    float t = clamp(vUv.y, 0.0, 1.0);
    vec3 viewDir = normalize(vViewV);
    float facing = abs(dot(normalize(vNormalV), viewDir));
    // Keep a readable volumetric floor at the silhouette: from the default
    // front camera most of the plume is seen as a ring around the nacelle.
    float body = mix(0.3, 1.0, pow(facing, uEdge));

    float travel = uTime * uMotion;
    float angle = vUv.x * 6.2831853 + uSeed * 2.4;
    float swirl = t * 2.6 - travel * (1.4 + uFlow);
    vec3 np = vec3(
      cos(angle + swirl * 0.25) * 0.9,
      sin(angle + swirl * 0.25) * 0.9,
      t * 5.2 - travel * (2.2 + uFlow * 2.0)
    );
    float n1 = fbm3(np);
    float n2 = fbm3(np * 2.15 + vec3(7.7, 3.1, travel * 1.3 + uSeed * 13.0));
    float turb = n1 * 0.62 + n2 * 0.52;
    float grain = smoothstep(0.16, 0.88, turb);

    float flicker = 1.0 + 0.26 * sin(travel * 15.0 + uSeed * 8.0) * (0.35 + uPower * 0.65);
    flicker *= mix(1.0, 0.94 + 0.06 * sin(travel * 6.3 + 1.7), uMotion);

    float axialFade = exp(-t * 1.45) * (1.0 - smoothstep(0.52, 1.0, t));
    float hotCore = exp(-t * 3.6);

    float diamonds = 0.0;
    for (int i = 0; i < 4; i++) {
      float c = 0.05 + float(i) * 0.11;
      float wobble = 0.014 * sin(travel * 4.2 + float(i) * 2.6 + uSeed * 5.0);
      float d = abs(t - c - wobble);
      diamonds += smoothstep(0.055, 0.0, d) * (1.0 - float(i) * 0.19);
    }
    diamonds *= uBand * (0.4 + 0.6 * uPower) * (0.35 + 0.65 * body) * (0.6 + 0.4 * grain);

    float density = (0.22 + grain * 0.95) * body;
    density *= mix(1.0, flicker, uMotion);

    float alpha = density * axialFade * (0.5 + hotCore * 1.45) * (1.0 + diamonds * 2.4);
    alpha *= uIntensity * (0.47 + 0.47 * uPower) * uDim;
    if (alpha < 0.004) discard;

    vec3 color = mix(uHot, uMid, smoothstep(0.0, 0.3, t));
    color = mix(color, uCool, smoothstep(0.28, 0.9, t));
    color += uHot * hotCore * (0.9 + uPower * 0.9);
    color += uHot * diamonds * 1.6;
    color *= 0.9 + 0.5 * flicker;

    gl_FragColor = vec4(color, alpha);
  }
`;

interface LayerConfig {
  /** Radial envelope in metres, sampled from nozzle (0) to tail (1). */
  profile: number[];
  length: number;
  intensity: number;
  band: number;
  flow: number;
  edge: number;
  seed: number;
  hot: string;
  mid: string;
  cool: string;
  renderOrder: number;
}

// Haze -> outer flame -> inner flame -> white-hot core.
// The near-nozzle radius stays inside the 0.79 m nozzle, then the plume swells
// past the 0.95 m nacelle so the fire reads from the default front three-quarter
// camera, where the nacelle itself would otherwise hide a thin straight cone.
const LAYERS: LayerConfig[] = [
  {
    profile: [0.3, 0.98, 1.32, 1.18, 0.88, 0.52, 0.24, 0.05],
    length: 6.8,
    intensity: 0.26,
    band: 0.0,
    flow: 0.7,
    edge: 1.6,
    seed: 0.13,
    hot: '#ff6a24',
    mid: '#dd3609',
    cool: '#761a05',
    renderOrder: 4,
  },
  {
    profile: [0.24, 0.74, 1.04, 0.94, 0.7, 0.42, 0.18, 0.04],
    length: 5.8,
    intensity: 0.66,
    band: 0.5,
    flow: 1.1,
    edge: 1.3,
    seed: 0.47,
    hot: '#ff9a4a',
    mid: '#ff641c',
    cool: '#d62d06',
    renderOrder: 5,
  },
  {
    profile: [0.16, 0.48, 0.66, 0.58, 0.42, 0.24, 0.09, 0.015],
    length: 4.5,
    intensity: 0.88,
    band: 1.2,
    flow: 1.55,
    edge: 1.1,
    seed: 0.71,
    hot: '#ffd6a0',
    mid: '#ffab52',
    cool: '#ff6718',
    renderOrder: 6,
  },
  {
    profile: [0.08, 0.17, 0.21, 0.18, 0.13, 0.07, 0.026, 0.004],
    length: 3.2,
    intensity: 0.72,
    band: 1.8,
    flow: 1.95,
    edge: 0.8,
    seed: 0.94,
    hot: '#fff8e8',
    mid: '#ffe3ad',
    cool: '#ffa544',
    renderOrder: 7,
  },
];

/** Lathe a radial envelope into a hollow, open-ended flame shell. */
function makePlumeGeometry(profile: number[]) {
  const points = profile.map(
    (radius, index) => new THREE.Vector2(radius, index / (profile.length - 1)),
  );
  const geometry = new THREE.LatheGeometry(points, 30);
  // Lathe axis is +Y; roll it so the near end (profile 0) sits at z=0 and the
  // tail extends down -Z.
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}

let flameSpriteTexture: THREE.CanvasTexture | null = null;

/** Soft additive flare texture shared by both engines. */
function getFlameSpriteTexture() {
  if (flameSpriteTexture) return flameSpriteTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,246,224,0.9)');
  gradient.addColorStop(0.4, 'rgba(255,196,120,0.42)');
  gradient.addColorStop(0.65, 'rgba(255,126,44,0.14)');
  gradient.addColorStop(1, 'rgba(255,96,24,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  flameSpriteTexture = new THREE.CanvasTexture(canvas);
  flameSpriteTexture.colorSpace = THREE.SRGBColorSpace;
  flameSpriteTexture.needsUpdate = true;
  return flameSpriteTexture;
}

export function PlasmaPlume({ side }: { side: 'L' | 'R' }) {
  const { power, reducedMotion, exploded } = useShip();
  const nozzle = ENGINE_NOZZLES[side === 'L' ? 0 : 1];
  const sideSeed = side === 'L' ? 0 : 0.317;

  const layerRuntime = useMemo(
    () =>
      LAYERS.map((config) => {
        const geometry = makePlumeGeometry(config.profile);

        const material = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uPower: { value: 0 },
            uMotion: { value: 1 },
            uSeed: { value: config.seed + sideSeed },
            uIntensity: { value: config.intensity },
            uBand: { value: config.band },
            uFlow: { value: config.flow },
            uEdge: { value: config.edge },
            uDim: { value: 1 },
            uHot: { value: new THREE.Color(config.hot) },
            uMid: { value: new THREE.Color(config.mid) },
            uCool: { value: new THREE.Color(config.cool) },
          },
          vertexShader: PLUME_VERTEX,
          fragmentShader: PLUME_FRAGMENT,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
          toneMapped: false,
        });

        return { config, geometry, material };
      }),
    [sideSeed],
  );

  const flareTexture = useMemo(() => getFlameSpriteTexture(), []);

  const hazeSpriteMaterial = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: flareTexture,
        color: new THREE.Color('#ff8a3d'),
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      }),
    [flareTexture],
  );

  const coreSpriteMaterial = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: flareTexture,
        color: new THREE.Color('#fff2d8'),
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      }),
    [flareTexture],
  );

  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hazeSprite = useRef<THREE.Sprite>(null);
  const coreSprite = useRef<THREE.Sprite>(null);
  const light = useRef<THREE.PointLight>(null);
  const powerRef = useRef(0);
  const dimRef = useRef(1);
  const elapsed = useRef(0);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    elapsed.current += delta;
    const time = elapsed.current;

    // Exploded diagram mode: keep a faint nozzle glow, but pull the fire down
    // to roughly 15-20% of the idle level so it never fights the module labels.
    dimRef.current = THREE.MathUtils.damp(dimRef.current, exploded ? 0.18 : 1, 4.5, delta);
    const dim = dimRef.current;

    const target = power === 'ignition' ? 1 : 0;
    powerRef.current = THREE.MathUtils.damp(
      powerRef.current,
      target,
      reducedMotion ? 10 : 3.6,
      delta,
    );
    const p = powerRef.current;
    const motion = reducedMotion ? 0.16 : 1;
    const seedPhase = sideSeed * 21.7;

    for (let i = 0; i < layerRuntime.length; i += 1) {
      const layer = layerRuntime[i];
      const mesh = meshRefs.current[i];
      if (!mesh) continue;

      const stretch = 0.8 + 0.55 * p;
      const length =
        layer.config.length *
        stretch *
        (1 + (reducedMotion ? 0 : 0.014 * Math.sin(time * 9 + layer.config.seed * 20)));
      const radialGain = 0.95 + 0.2 * p;
      // Lathe geometry spans z 0 (nozzle) .. -1 (tail); axial is local z.
      mesh.scale.set(radialGain, radialGain, length);
      mesh.position.z = 0;

      const uniforms = layer.material.uniforms;
      uniforms.uTime.value = time;
      uniforms.uPower.value = p;
      uniforms.uMotion.value = motion;
      uniforms.uDim.value = dim;
    }

    const flicker = reducedMotion
      ? 1
      : 0.86 + 0.14 * Math.sin(time * 11.3 + seedPhase) * Math.sin(time * 5.7 + 1.3 + seedPhase);

    if (hazeSprite.current) {
      const scale = 1.3 + p * 0.6 + flicker * 0.08;
      hazeSprite.current.scale.setScalar(scale);
      hazeSpriteMaterial.opacity = (0.08 + p * 0.15) * flicker * dim;
    }
    if (coreSprite.current) {
      coreSprite.current.scale.setScalar(0.6 + p * 0.25 + flicker * 0.04);
      coreSpriteMaterial.opacity = (0.18 + p * 0.18) * flicker * dim;
    }
    if (light.current) {
      light.current.intensity = (0.6 + p * 3.2) * (0.9 + 0.1 * flicker) * dim;
    }
  });

  return (
    <group
      position={[nozzle[0], nozzle[1], nozzle[2] - 0.035]}
      rotation={[-0.08, 0, 0]}
      name={`plasma-plume-${side}`}
    >
      {layerRuntime.map((layer, index) => (
        <mesh
          key={layer.config.seed}
          ref={(node) => {
            meshRefs.current[index] = node;
          }}
          geometry={layer.geometry}
          material={layer.material}
          renderOrder={layer.config.renderOrder}
          frustumCulled={false}
          raycast={() => {}}
        />
      ))}

      <sprite
        ref={hazeSprite}
        material={hazeSpriteMaterial}
        position={[0, -0.02, -1.15]}
        scale={[1.3, 1.3, 1.3]}
        renderOrder={9}
        raycast={() => {}}
      />
      <sprite
        ref={coreSprite}
        material={coreSpriteMaterial}
        position={[0, -0.01, -0.4]}
        scale={[0.6, 0.6, 0.6]}
        renderOrder={10}
        raycast={() => {}}
      />
      <pointLight
        ref={light}
        color="#ff7a2a"
        intensity={1.5}
        distance={7.5}
        decay={2}
        position={[0, -0.04, -0.95]}
      />
    </group>
  );
}
