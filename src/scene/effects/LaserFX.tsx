import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WEAPON_MUZZLES } from '../../data/ship';
import { useShip } from '../../state/ship';

/**
 * LANCE-7 sustained test beams.
 *
 * Two converging additive beams are mounted at the scene root (light follows the
 * ship float) and fire from the wing-pod muzzles toward +Z. The beams are never
 * unmounted so the shader programs stay warm; visibility is a uniform fade.
 * Exploded view forces them dark on the same frame.
 */

const BEAM_Z_LENGTH = 10;
const CONVERGENCE = 1.06;
const BEAM_DROP = 3.6;

const LASER_NOISE = /* glsl */ `
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

const BEAM_VERTEX = /* glsl */ `
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

const BEAM_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uFire;
  uniform float uIntensity;
  uniform float uSeed;
  uniform float uSpeed;
  uniform float uWhiten;
  uniform float uEdge;
  uniform vec3 uColor;

  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewV;

  ${LASER_NOISE}

  void main() {
    float t = clamp(vUv.y, 0.0, 1.0);
    vec3 viewDir = normalize(vViewV);
    float facing = abs(dot(normalize(vNormalV), viewDir));
    float body = pow(facing, uEdge);

    float angle = vUv.x * 6.2831853;
    float travel = uTime * uSpeed;
    float ribbon = fbm3(vec3(cos(angle) * 1.6, sin(angle) * 1.6, t * 16.0 - travel * 2.2));
    float pulses = pow(0.5 + 0.5 * sin((t * 4.0 - travel * 0.9 + uSeed) * 6.2831853), 9.0);
    float fade = 1.0 - smoothstep(0.5, 1.0, t);
    float ignition = smoothstep(0.0, 0.06, t);
    float emitter = exp(-t * 10.0);

    float alpha = uIntensity * uFire * fade * ignition * (0.3 + body * 0.95);
    alpha *= 0.35 + ribbon * 0.95 + pulses * 1.4 + emitter * 1.7;
    if (alpha < 0.004) discard;

    vec3 color = mix(uColor, vec3(1.0), clamp(uWhiten + emitter * 0.65 + pulses * 0.2, 0.0, 1.0));
    color += vec3(1.0) * emitter * 0.8;
    color *= 1.0 + pulses * 1.25;

    gl_FragColor = vec4(color, alpha);
  }
`;

interface BeamLayerConfig {
  radius: number;
  intensity: number;
  color: string;
  whiten: number;
  speed: number;
  edge: number;
  renderOrder: number;
}

// White-hot core -> ion glow -> soft outer heat haze.
const BEAM_LAYERS: BeamLayerConfig[] = [
  {
    radius: 0.0045,
    intensity: 1.1,
    color: '#f4ffff',
    whiten: 0.55,
    speed: 3.2,
    edge: 0.4,
    renderOrder: 21,
  },
  {
    radius: 0.065,
    intensity: 0.22,
    color: '#5fe7f2',
    whiten: 0.15,
    speed: 2.6,
    edge: 1.0,
    renderOrder: 22,
  },
  {
    radius: 0.18,
    intensity: 0.035,
    color: '#2ad2e8',
    whiten: 0.0,
    speed: 1.8,
    edge: 1.8,
    renderOrder: 23,
  },
];

let flareTexture: THREE.CanvasTexture | null = null;

function getLaserFlareTexture() {
  if (flareTexture) return flareTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.16, 'rgba(226,255,255,0.92)');
  gradient.addColorStop(0.38, 'rgba(120,244,255,0.4)');
  gradient.addColorStop(0.68, 'rgba(40,200,232,0.12)');
  gradient.addColorStop(1, 'rgba(24,170,210,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  flareTexture = new THREE.CanvasTexture(canvas);
  flareTexture.colorSpace = THREE.SRGBColorSpace;
  flareTexture.needsUpdate = true;
  return flareTexture;
}

const upAxis = new THREE.Vector3(0, 1, 0);

interface BeamGeometryData {
  midpoint: THREE.Vector3;
  direction: THREE.Quaternion;
  length: number;
  start: THREE.Vector3;
}

function buildBeams(): BeamGeometryData[] {
  return WEAPON_MUZZLES.map((muzzle) => {
    const start = new THREE.Vector3(muzzle[0], muzzle[1], muzzle[2]);
    // Slight convergence + downward lead: both beams stay readable from the
    // default front three-quarter camera instead of foreshortening into one rod.
    const target = new THREE.Vector3(
      muzzle[0] * CONVERGENCE,
      -BEAM_DROP,
      muzzle[2] + BEAM_Z_LENGTH,
    );
    const delta = target.clone().sub(start);
    const length = delta.length();
    const direction = new THREE.Quaternion().setFromUnitVectors(upAxis, delta.normalize());
    const midpoint = start.clone().addScaledVector(delta.clone().normalize(), length * 0.5);
    return { midpoint, direction, length, start };
  });
}

export function LaserFX() {
  const { weapon, exploded } = useShip();

  const beamGeometry = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true);
    geometry.computeBoundingSphere();
    return geometry;
  }, []);

  const beams = useMemo(() => buildBeams(), []);

  const flareTextureRef = useMemo(() => getLaserFlareTexture(), []);

  const runtime = useMemo(
    () =>
      beams.map((beam, beamIndex) => {
        const materials = BEAM_LAYERS.map((layer, layerIndex) => {
          const material = new THREE.ShaderMaterial({
            uniforms: {
              uTime: { value: 0 },
              uFire: { value: 0 },
              uIntensity: { value: layer.intensity },
              uSeed: { value: 0.17 + beamIndex * 0.41 + layerIndex * 0.23 },
              uSpeed: { value: layer.speed },
              uWhiten: { value: layer.whiten },
              uEdge: { value: layer.edge },
              uColor: { value: new THREE.Color(layer.color) },
            },
            vertexShader: BEAM_VERTEX,
            fragmentShader: BEAM_FRAGMENT,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            toneMapped: false,
          });
          return material;
        });

        const flareMaterial = new THREE.SpriteMaterial({
          map: flareTextureRef,
          color: new THREE.Color('#bdf8ff'),
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          toneMapped: false,
        });

        return { beam, materials, flareMaterial };
      }),
    [beams, flareTextureRef],
  );

  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const flareRefs = useRef<(THREE.Sprite | null)[]>([]);
  const fireRef = useRef(0);
  const elapsed = useRef(0);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    elapsed.current += delta;
    const time = elapsed.current;

    const enabled = weapon && !exploded;
    if (exploded) {
      fireRef.current = 0;
    } else {
      fireRef.current = THREE.MathUtils.damp(
        fireRef.current,
        enabled ? 1 : 0,
        enabled ? 7.5 : 10,
        delta,
      );
    }
    const fire = fireRef.current;
    const visible = fire > 0.002 && !exploded;

    for (let i = 0; i < runtime.length; i += 1) {
      const entry = runtime[i];
      const group = groupRefs.current[i];
      if (group) group.visible = visible;
      for (let layer = 0; layer < entry.materials.length; layer += 1) {
        const uniforms = entry.materials[layer].uniforms;
        uniforms.uTime.value = time;
        uniforms.uFire.value = fire;
      }

      const flare = flareRefs.current[i];
      if (flare) {
        const pulse = 0.82 + 0.18 * Math.sin(time * 19 + i * 2.3);
        flare.scale.setScalar((0.78 + fire * 0.5) * pulse);
        entry.flareMaterial.opacity = fire * pulse * 0.78;
      }
    }
  });

  return (
    <group name="laser-fx">
      {runtime.map((entry, beamIndex) => (
        <group
          key={beamIndex}
          ref={(node) => {
            groupRefs.current[beamIndex] = node;
          }}
          position={entry.beam.midpoint}
          quaternion={entry.beam.direction}
        >
          {BEAM_LAYERS.map((layer, layerIndex) => (
            <mesh
              key={layer.renderOrder}
              geometry={beamGeometry}
              material={entry.materials[layerIndex]}
              scale={[layer.radius, entry.beam.length, layer.radius]}
              renderOrder={layer.renderOrder}
              frustumCulled={false}
              raycast={() => {}}
            />
          ))}
        </group>
      ))}

      {runtime.map((entry, beamIndex) => (
        <group key={`flare-${beamIndex}`} position={entry.beam.start}>
          <sprite
            ref={(node) => {
              flareRefs.current[beamIndex] = node;
            }}
            material={entry.flareMaterial}
            scale={[0.7, 0.7, 0.7]}
            renderOrder={24}
            raycast={() => {}}
          />
        </group>
      ))}
    </group>
  );
}
