/* eslint-disable react/no-unknown-property */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { makeDecalTexture, useShipMaterials } from '../materials';
import { useShip } from '../../../state/ship';
import {
  boxGeo,
  cylinderGeo,
  flatMatrix,
  loftGeometry,
  Merged,
  panelGeometry,
  placeAlong,
  placeBolt,
  placeFlat,
  ringFrameGeometry,
  Stencil,
  surfaceAt,
  tf,
  vec,
  type HullSection,
  type StencilPlacement,
} from './fuselage';

/* ------------------------------------------------------------------------- */
/* Fusion core                                                               */
/* ------------------------------------------------------------------------- */

interface CoreBuilt {
  dark: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  black: THREE.BufferGeometry[];
  core: THREE.BufferGeometry[];
  glowCyan: THREE.BufferGeometry[];
  glowOrange: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
  rings: THREE.BufferGeometry[];
}

export function buildCore(): CoreBuilt {
  const dark: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const black: THREE.BufferGeometry[] = [];
  const core: THREE.BufferGeometry[] = [];
  const glowCyan: THREE.BufferGeometry[] = [];
  const glowOrange: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const rings: THREE.BufferGeometry[] = [];

  /* Vacuum vessel: two hemispheres split by a glass diagnostic band. */
  const top = new THREE.SphereGeometry(0.37, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  top.scale(1, 0.92, 1);
  dark.push(tf(top, 0, 0.07, 0));
  const bottom = new THREE.SphereGeometry(0.37, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bottom.scale(1, 0.92, 1);
  dark.push(tf(bottom, 0, -0.07, 0));
  glass.push(tf(new THREE.CylinderGeometry(0.372, 0.372, 0.16, 32, 1, true), 0, 0, 0));
  trim.push(tf(new THREE.TorusGeometry(0.375, 0.018, 6, 36), 0, 0.085, 0, Math.PI / 2, 0, 0));
  trim.push(tf(new THREE.TorusGeometry(0.375, 0.018, 6, 36), 0, -0.085, 0, Math.PI / 2, 0, 0));

  /* Confinement coils around the vessel. */
  for (const y of [-0.15, 0.15]) {
    trim.push(tf(new THREE.TorusGeometry(0.43, 0.032, 8, 36), 0, y, 0, Math.PI / 2, 0, 0));
    dark.push(tf(new THREE.TorusGeometry(0.43, 0.05, 6, 12), 0, y, 0, Math.PI / 2, 0, 0));
  }
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const x = Math.cos(angle) * 0.43;
    const z = Math.sin(angle) * 0.43;
    trim.push(tf(boxGeo(0.07, 0.16, 0.09), x, 0, z, 0, -angle, 0));
  }

  /* Glowing plasma torus and hot centre. */
  const plasma = new THREE.TorusGeometry(0.27, 0.085, 14, 44);
  core.push(tf(plasma, 0, 0, 0, Math.PI / 2, 0, 0));
  core.push(tf(new THREE.SphereGeometry(0.13, 20, 14), 0, 0, 0));
  glowOrange.push(tf(new THREE.TorusGeometry(0.15, 0.018, 8, 28), 0, 0, 0, Math.PI / 2, 0, 0));
  glowCyan.push(tf(new THREE.TorusGeometry(0.365, 0.006, 6, 40), 0, 0.085, 0, Math.PI / 2, 0, 0));
  glowCyan.push(tf(new THREE.TorusGeometry(0.365, 0.006, 6, 40), 0, -0.085, 0, Math.PI / 2, 0, 0));
  black.push(tf(new THREE.CylinderGeometry(0.372, 0.372, 0.02, 32, 1, true), 0, -0.16, 0));
  black.push(tf(new THREE.CylinderGeometry(0.372, 0.372, 0.02, 32, 1, true), 0, 0.16, 0));

  /* Magnetic gyro rings, animated as a group. */
  const gyro = [
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    [0, 0, Math.PI / 2],
  ] as const;
  for (let i = 0; i < gyro.length; i += 1) {
    const [rx, ry, rz] = gyro[i];
    rings.push(tf(new THREE.TorusGeometry(0.57, 0.024, 8, 56), 0, 0, 0, rx, ry, rz));
    const arc = new THREE.TorusGeometry(0.57, 0.008, 6, 24, 1.15);
    rings.push(tf(arc, 0, 0, 0, rx, ry, rz));
  }
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    trim.push(
      tf(boxGeo(0.05, 0.06, 0.05), Math.cos(angle) * 0.57, 0, Math.sin(angle) * 0.57, 0, -angle, 0),
    );
  }

  /* Support cradle: saddle hoops, struts, base ring and radiator fins. */
  for (const z of [-0.24, 0.24]) {
    const hoop = new THREE.TorusGeometry(0.46, 0.034, 8, 30, Math.PI);
    trim.push(tf(hoop, 0, -0.02, z, 0, 0, Math.PI));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      trim.push(tf(boxGeo(0.06, 0.34, 0.05), sx * 0.3, -0.36, sz * 0.24, sx * 0.28, 0, sz * 0.1));
    }
  }
  trim.push(tf(new THREE.CylinderGeometry(0.4, 0.44, 0.08, 28), 0, -0.56, 0));
  dark.push(tf(new THREE.CylinderGeometry(0.46, 0.46, 0.035, 28), 0, -0.615, 0));
  black.push(tf(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 24), 0, -0.592, 0));
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    trim.push(
      tf(
        boxGeo(0.05, 0.12, 0.11),
        Math.cos(angle) * 0.405,
        -0.5,
        Math.sin(angle) * 0.405,
        0,
        -angle + Math.PI / 2,
        0,
      ),
    );
  }
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    placeBolt(
      trim,
      new THREE.Vector3(Math.cos(angle) * 0.36, -0.605, Math.sin(angle) * 0.36),
      new THREE.Vector3(0, -1, 0),
      0.016,
    );
  }

  /* Fuel injectors angled into the vessel crown. */
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 3;
    const base = new THREE.Vector3(Math.cos(angle) * 0.34, 0.44, Math.sin(angle) * 0.34);
    const target = new THREE.Vector3(0, 0.1, 0);
    const direction = target.clone().sub(base).normalize();
    trim.push(placeAlong(cylinderGeo(0.05, 0.06, 0.34, 10), base, direction));
    dark.push(placeAlong(cylinderGeo(0.075, 0.075, 0.05, 10), base, direction));
    glowCyan.push(
      placeAlong(cylinderGeo(0.028, 0.028, 0.02, 8), target.clone().addScaledVector(direction, -0.05), direction),
    );
  }

  /* Coolant pipes from the vessel shoulder to the base ring. */
  for (const side of [1, -1]) {
    const points = [
      new THREE.Vector3(side * 0.26, 0.22, 0.06),
      new THREE.Vector3(side * 0.34, 0.05, 0.1),
      new THREE.Vector3(side * 0.38, -0.2, 0.05),
      new THREE.Vector3(side * 0.34, -0.5, side * 0.02),
    ];
    trim.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, 0.022, 6, false));
    for (const point of [points[1], points[2]]) {
      trim.push(tf(cylinderGeo(0.034, 0.034, 0.04, 8), point.x, point.y, point.z));
    }
  }

  /* Instrument can mounted on the base rim. */
  const canBase = new THREE.Vector3(0.44, -0.5, 0.16);
  const canNormal = new THREE.Vector3(0.95, 0.12, 0.28).normalize();
  dark.push(placeAlong(cylinderGeo(0.07, 0.07, 0.06, 12), canBase, canNormal));
  glowCyan.push(
    placeFlat(
      new THREE.TorusGeometry(0.055, 0.006, 5, 16),
      canBase.clone().addScaledVector(canNormal, 0.032),
      canNormal,
    ),
  );

  return { dark, trim, black, core, glowCyan, glowOrange, glass, rings };
}

function coreStencils(): StencilPlacement[] {
  const label = makeDecalTexture(['FUSION CORE', 'Mk.IV'], { width: 512, height: 224 });
  return [
    {
      key: 'core-label',
      texture: label,
      position: [0, -0.53, 0.425],
      normal: [0, 0, 1],
      width: 0.42,
      height: 0.18,
    },
  ];
}

export function FusionCore() {
  const materials = useShipMaterials();
  const { power, reducedMotion } = useShip();
  const built = useMemo(buildCore, []);
  const stencils = useMemo(coreStencils, []);
  const ringGroup = useRef<THREE.Group>(null);

  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();
    const pulse = reducedMotion ? 1 : 0.86 + Math.sin(elapsed * 2.6) * 0.14;
    materials.core.emissiveIntensity = (power === 'ignition' ? 6.2 : 3.6) * pulse;
    materials.glowCyan.emissiveIntensity = (power === 'ignition' ? 4.4 : 3.2) * pulse;
    materials.glowOrange.emissiveIntensity = (power === 'ignition' ? 5.4 : 3.8) * pulse;
    if (ringGroup.current && !reducedMotion) {
      ringGroup.current.rotation.y = elapsed * 0.16;
      ringGroup.current.rotation.z = Math.sin(elapsed * 0.22) * 0.22;
    }
  });

  return (
    <group name="fusion-core" position={[0, 0.05, -0.4]}>
      <Merged geos={built.dark} material={materials.dark} />
      <Merged geos={built.trim} material={materials.trim} />
      <Merged geos={built.black} material={materials.black} />
      <Merged geos={built.core} material={materials.core} cast={false} />
      <Merged geos={built.glowCyan} material={materials.glowCyan} cast={false} receive={false} />
      <Merged geos={built.glowOrange} material={materials.glowOrange} cast={false} receive={false} />
      <Merged geos={built.glass} material={materials.glass} cast={false} />
      <group ref={ringGroup}>
        <Merged geos={built.rings} material={materials.trim} cast={false} />
      </group>
      {stencils.map(({ key, ...rest }) => (
        <Stencil key={key} {...rest} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------------- */
/* Ventral mission pod                                                       */
/* ------------------------------------------------------------------------- */

const POD: HullSection[] = [
  { z: -1.82, w: 0.32, top: 0.02, bot: -0.28, e: 3.2 },
  { z: -1.55, w: 0.5, top: 0.03, bot: -0.4, e: 3.2 },
  { z: -1.1, w: 0.68, top: 0.03, bot: -0.5, e: 3.3 },
  { z: -0.4, w: 0.8, top: 0.04, bot: -0.58, e: 3.4 },
  { z: 0.4, w: 0.82, top: 0.04, bot: -0.61, e: 3.4 },
  { z: 1.1, w: 0.76, top: 0.04, bot: -0.56, e: 3.4 },
  { z: 1.7, w: 0.6, top: 0.03, bot: -0.46, e: 3.3 },
  { z: 2.0, w: 0.42, top: 0.02, bot: -0.34, e: 3.2 },
  { z: 2.18, w: 0.24, top: 0.015, bot: -0.22, e: 3 },
];

interface PodBuilt {
  hull: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  dark: THREE.BufferGeometry[];
  black: THREE.BufferGeometry[];
  ceramic: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
  accent: THREE.BufferGeometry[];
  glowCyan: THREE.BufferGeometry[];
  glowOrange: THREE.BufferGeometry[];
}

function addPodBay(
  frame: THREE.BufferGeometry[],
  doors: THREE.BufferGeometry[],
  dark: THREE.BufferGeometry[],
  glow: THREE.BufferGeometry[],
  trim: THREE.BufferGeometry[],
  z: number,
  t: number,
  width: number,
  length: number,
) {
  const sample = surfaceAt(POD, z, t);
  const matrix = flatMatrix(sample.position.clone().addScaledVector(sample.normal, 0.016), sample.normal);
  const frameGeo = ringFrameGeometry(width, length, 0.06, 0.026, 0.02);
  frameGeo.applyMatrix4(matrix);
  frame.push(frameGeo);
  const door = tf(boxGeo(width - 0.05, length - 0.05, 0.016), 0, 0, 0.006);
  door.applyMatrix4(matrix);
  doors.push(door);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const local = new THREE.Vector3(sx * (width / 2 - 0.02), sy * (length / 2 - 0.02), 0.024);
      placeBolt(trim, local.clone().applyMatrix4(matrix), sample.normal, 0.009);
    }
  }
  const hinge = new THREE.Vector3(-width * 0.3, length * 0.5 - 0.01, 0.03).applyMatrix4(matrix);
  trim.push(tf(cylinderGeo(0.018, 0.018, 0.1, 8), hinge.x, hinge.y, hinge.z, 0, 0, Math.PI / 2));
  const actuator = new THREE.Vector3(width * 0.42, 0, 0.03).applyMatrix4(matrix);
  dark.push(placeAlong(cylinderGeo(0.024, 0.024, 0.06, 8), actuator, sample.normal));
  const status = new THREE.Vector3(-width * 0.35, -length * 0.36, 0.03).applyMatrix4(matrix);
  glow.push(placeFlat(boxGeo(0.05, 0.02, 0.01), status, sample.normal));
}

export function buildPod(): PodBuilt {
  const hull: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const black: THREE.BufferGeometry[] = [];
  const ceramic: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const glowCyan: THREE.BufferGeometry[] = [];
  const glowOrange: THREE.BufferGeometry[] = [];

  trim.push(loftGeometry(POD, -1.82, 2.18, { rings: 30, radial: 30 }));

  /* Side armour and belly doors. */
  for (const side of [1, -1]) {
    const spans: [number, number][] = [
      [-1.5, -0.55],
      [-0.35, 0.4],
      [0.6, 1.2],
      [1.35, 1.75],
    ];
    for (const [z0, z1] of spans) {
      hull.push(
        panelGeometry(POD, z0, z1, side * 0.12, side * 0.21, { rise: 0.02, segZ: 3, segT: 3 }),
      );
      for (const z of [z0 + 0.1, z1 - 0.1]) {
        const sample = surfaceAt(POD, z, side * 0.185);
        sample.position.addScaledVector(sample.normal, 0.024);
        placeBolt(trim, sample.position, sample.normal, 0.009);
      }
    }
    ceramic.push(
      panelGeometry(POD, 1.45, 1.95, side * 0.1, side * 0.19, { rise: 0.026, segZ: 2, segT: 3 }),
    );
    dark.push(
      panelGeometry(POD, -1.75, 1.9, side * 0.28 - 0.008, side * 0.28 + 0.008, {
        rise: 0.006,
        segZ: 16,
        segT: 1,
      }),
    );
  }
  for (const [z0, z1] of [
    [-1.45, -0.7],
    [0.55, 1.45],
  ]) {
    dark.push(panelGeometry(POD, z0, z1, 0.43, 0.48, { rise: 0.018, segZ: 3, segT: 2 }));
    dark.push(panelGeometry(POD, z0, z1, 0.52, 0.57, { rise: 0.018, segZ: 3, segT: 2 }));
  }

  /* Landing gear bays. */
  addPodBay(trim, dark, dark, glowCyan, trim, 1.3, 0.5, 0.34, 0.42);
  addPodBay(trim, dark, dark, glowCyan, trim, -1.2, 0.5, 0.3, 0.38);
  for (const z of [1.3, -1.2]) {
    for (const side of [-1, 1]) {
      dark.push(tf(cylinderGeo(0.028, 0.028, 0.24, 8), side * 0.22, -0.34, z, 0, 0, side * 0.45));
    }
  }

  /* Docking ring with androgynous latches and guide petals. */
  const ringY = -0.625;
  const ringZ = 0.25;
  trim.push(tf(new THREE.TorusGeometry(0.27, 0.036, 8, 30), 0, ringY, ringZ, Math.PI / 2, 0, 0));
  dark.push(tf(new THREE.TorusGeometry(0.2, 0.022, 6, 24), 0, ringY + 0.01, ringZ, Math.PI / 2, 0, 0));
  black.push(tf(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 24), 0, ringY + 0.03, ringZ));
  trim.push(tf(new THREE.CylinderGeometry(0.085, 0.1, 0.06, 12), 0, ringY + 0.03, ringZ));
  glowCyan.push(tf(new THREE.TorusGeometry(0.235, 0.006, 5, 30), 0, ringY + 0.012, ringZ, Math.PI / 2, 0, 0));
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const x = Math.cos(angle) * 0.3;
    const z = ringZ + Math.sin(angle) * 0.3;
    trim.push(tf(boxGeo(0.075, 0.05, 0.14), x, ringY + 0.005, z, 0, -angle, 0));
    dark.push(tf(boxGeo(0.04, 0.03, 0.1), x * 0.82, ringY + 0.01, ringZ + (z - ringZ) * 0.82, 0, -angle, 0));
    trim.push(tf(boxGeo(0.05, 0.02, 0.16), x * 1.08, ringY + 0.02, ringZ + (z - ringZ) * 1.08, 0, -angle, 0));
  }
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    placeBolt(
      trim,
      new THREE.Vector3(Math.cos(angle) * 0.34, ringY + 0.015, ringZ + Math.sin(angle) * 0.34),
      new THREE.Vector3(0, -1, 0),
      0.011,
    );
  }

  /* Forward mission sensor window set into the nose of the pod. */
  const frontSensor = surfaceAt(POD, 2.03, 0.5);
  const frontMatrix = flatMatrix(
    frontSensor.position.clone().addScaledVector(frontSensor.normal, 0.01),
    frontSensor.normal,
  );
  const frontFrame = ringFrameGeometry(0.2, 0.14, 0.04, 0.018, 0.012);
  frontFrame.applyMatrix4(frontMatrix);
  trim.push(frontFrame);
  dark.push(
    placeFlat(
      boxGeo(0.14, 0.09, 0.02),
      frontSensor.position.clone().addScaledVector(frontSensor.normal, 0.018),
      frontSensor.normal,
    ),
  );
  glass.push(
    placeAlong(
      cylinderGeo(0.042, 0.042, 0.012, 16),
      frontSensor.position.clone().addScaledVector(frontSensor.normal, 0.036),
      frontSensor.normal,
    ),
  );
  for (const sx of [-1, 1]) {
    const local = new THREE.Vector3(sx * 0.07, 0.055, 0.024);
    placeBolt(trim, local.applyMatrix4(frontMatrix), frontSensor.normal, 0.008);
  }
  const alt = surfaceAt(POD, 1.9, 0.56);
  alt.position.addScaledVector(alt.normal, 0.012);
  dark.push(placeFlat(boxGeo(0.2, 0.11, 0.06), alt.position, alt.normal));
  const turret = surfaceAt(POD, 1.62, 0.54);
  trim.push(placeAlong(cylinderGeo(0.075, 0.085, 0.04, 12), turret.position, turret.normal));
  const ball = new THREE.SphereGeometry(0.065, 14, 10);
  glass.push(placeAlong(ball, turret.position.clone().addScaledVector(turret.normal, 0.045), turret.normal));

  /* Mission bay doors on the flanks. */
  for (const side of [1, -1]) {
    for (const z of [-0.15, 0.85]) {
      const sample = surfaceAt(POD, z, side * 0.165);
      const matrix = flatMatrix(
        sample.position.clone().addScaledVector(sample.normal, 0.026),
        sample.normal,
      );
      const frame = ringFrameGeometry(0.24, 0.46, 0.05, 0.022, 0.014);
      frame.applyMatrix4(matrix);
      trim.push(frame);
      const door = tf(boxGeo(0.2, 0.42, 0.012), 0, 0, 0.004);
      door.applyMatrix4(matrix);
      dark.push(door);
      for (const sy of [-1, 1]) {
        const local = new THREE.Vector3(-0.1, sy * 0.17, 0.02);
        const world = local.applyMatrix4(matrix);
        trim.push(tf(cylinderGeo(0.015, 0.015, 0.06, 8), world.x, world.y, world.z));
      }
    }
  }

  /* Reaction control ports and running lights. */
  for (const z of [1.75, -1.55]) {
    for (const side of [1, -1]) {
      const sample = surfaceAt(POD, z, side * 0.24);
      const world = sample.position.clone().addScaledVector(sample.normal, 0.008);
      for (let i = -1; i <= 1; i += 2) {
        const offset = new THREE.Vector3(0, i * 0.085, 0).applyMatrix4(
          flatMatrix(world, sample.normal),
        );
        dark.push(placeAlong(cylinderGeo(0.026, 0.03, 0.03, 8), offset, sample.normal));
        trim.push(
          placeFlat(
            new THREE.TorusGeometry(0.028, 0.005, 5, 10),
            offset.clone().addScaledVector(sample.normal, 0.016),
            sample.normal,
          ),
        );
      }
      glowOrange.push(
        placeFlat(
          boxGeo(0.05, 0.02, 0.016),
          sample.position.clone().addScaledVector(sample.normal, 0.014),
          sample.normal,
        ),
      );
    }
  }

  /* Cable conduits along the pod flanks. */
  for (const side of [1, -1]) {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i += 1) {
      const sample = surfaceAt(POD, THREE.MathUtils.lerp(-1.6, 1.85, i / 14), side * 0.32);
      points.push(sample.position.clone().addScaledVector(sample.normal, 0.026));
    }
    trim.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 26, 0.016, 6, false));
    for (let i = 0; i < 5; i += 1) {
      const sample = surfaceAt(POD, -1.4 + i * 0.8, side * 0.32);
      sample.position.addScaledVector(sample.normal, 0.026);
      dark.push(placeFlat(boxGeo(0.05, 0.045, 0.04), sample.position, sample.normal));
    }
  }

  /* Service greebles. */
  for (let i = 0; i < 24; i += 1) {
    const z = -1.5 + (i / 24) * 3.4;
    const side = i % 2 === 0 ? 1 : -1;
    const sample = surfaceAt(POD, z, side * (0.23 + (i % 3) * 0.025));
    sample.position.addScaledVector(sample.normal, 0.008);
    const w = 0.05 + (i % 4) * 0.03;
    const h = 0.03 + (i % 5) * 0.015;
    trim.push(placeFlat(boxGeo(w, h, 0.025), sample.position, sample.normal));
  }

  /* Uplink antenna folded against the keel. */
  trim.push(tf(boxGeo(0.06, 0.06, 0.18), 0, -0.56, -1.65));
  black.push(tf(boxGeo(0.04, 0.02, 0.1), 0, -0.6, -1.72));

  return { hull, trim, dark, black, ceramic, glass, accent, glowCyan, glowOrange };
}

function podStencils(): StencilPlacement[] {
  const bay = makeDecalTexture(['VENTRAL BAY 11'], { width: 512, height: 160 });
  const dock = makeDecalTexture(['DOCKING', 'ANDROGYNOUS'], { width: 512, height: 220 });
  const step = makeDecalTexture(['NO STEP'], { width: 512, height: 180, align: 'center' });

  const side = surfaceAt(POD, 0.1, 0.235);
  const bottom = surfaceAt(POD, 0.55, 0.5);
  return [
    {
      key: 'pod-name',
      texture: bay,
      position: vec(side.position.clone().addScaledVector(side.normal, 0.03)),
      normal: vec(side.normal),
      width: 0.5,
      height: 0.16,
    },
    {
      key: 'pod-dock',
      texture: dock,
      position: vec(bottom.position.clone().addScaledVector(bottom.normal, 0.024)),
      normal: vec(bottom.normal),
      width: 0.34,
      height: 0.16,
      up: [0, 0, 1],
    },
    {
      key: 'pod-step',
      texture: step,
      position: vec(
        surfaceAt(POD, 1.55, 0.42).position
          .clone()
          .addScaledVector(surfaceAt(POD, 1.55, 0.42).normal, 0.026),
      ),
      normal: vec(surfaceAt(POD, 1.55, 0.42).normal),
      width: 0.28,
      height: 0.1,
      up: [0, 0, 1],
    },
  ];
}

export function BellyPod() {
  const materials = useShipMaterials();
  const built = useMemo(buildPod, []);
  const stencils = useMemo(podStencils, []);

  return (
    <group name="ventral-pod" position={[0, -0.83, 0]}>
      <Merged geos={built.trim} material={materials.trim} />
      <Merged geos={built.hull} material={materials.hull} />
      <Merged geos={built.ceramic} material={materials.ceramic} />
      <Merged geos={built.dark} material={materials.dark} />
      <Merged geos={built.black} material={materials.black} />
      <Merged geos={built.accent} material={materials.accent} />
      <Merged geos={built.glass} material={materials.glass} cast={false} />
      <Merged geos={built.glowCyan} material={materials.glowCyan} cast={false} receive={false} />
      <Merged geos={built.glowOrange} material={materials.glowOrange} cast={false} receive={false} />
      {stencils.map(({ key, ...rest }) => (
        <Stencil key={key} {...rest} />
      ))}
    </group>
  );
}
