/* eslint-disable react/no-unknown-property */
import { useMemo } from 'react';
import * as THREE from 'three';
import { makeDecalTexture, useShipMaterials } from '../materials';
import {
  boltRing,
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
/* Profiles                                                                  */
/* ------------------------------------------------------------------------- */

const CANOPY: HullSection[] = [
  { z: 1.9, w: 0.42, top: 0.16, bot: -0.3, e: 2.2, yc: 0.97 },
  { z: 2.15, w: 0.62, top: 0.28, bot: -0.36, e: 2.3, yc: 0.97 },
  { z: 2.55, w: 0.78, top: 0.4, bot: -0.42, e: 2.4, yc: 0.97 },
  { z: 3.05, w: 0.82, top: 0.45, bot: -0.43, e: 2.5, yc: 0.97 },
  { z: 3.55, w: 0.8, top: 0.44, bot: -0.42, e: 2.4, yc: 0.97 },
  { z: 4.0, w: 0.68, top: 0.36, bot: -0.42, e: 2.3, yc: 0.97 },
  { z: 4.3, w: 0.5, top: 0.24, bot: -0.42, e: 2.2, yc: 0.97 },
  { z: 4.4, w: 0.3, top: 0.12, bot: -0.42, e: 2.1, yc: 0.97 },
];

const SILL: HullSection[] = [
  { z: 1.9, w: 0.48, top: 0.05, bot: -0.12, e: 2.6, yc: 0.7 },
  { z: 2.1, w: 0.7, top: 0.075, bot: -0.14, e: 2.7, yc: 0.7 },
  { z: 2.55, w: 0.82, top: 0.09, bot: -0.15, e: 2.8, yc: 0.7 },
  { z: 3.1, w: 0.84, top: 0.09, bot: -0.15, e: 2.8, yc: 0.7 },
  { z: 3.6, w: 0.79, top: 0.08, bot: -0.14, e: 2.7, yc: 0.7 },
  { z: 4.1, w: 0.65, top: 0.07, bot: -0.13, e: 2.6, yc: 0.7 },
  { z: 4.38, w: 0.46, top: 0.05, bot: -0.12, e: 2.5, yc: 0.7 },
];

const DORSAL: HullSection[] = [
  { z: -3.7, w: 0.38, top: 0.145, bot: -0.17, e: 3.2, yc: 0.95 },
  { z: -3.45, w: 0.6, top: 0.22, bot: -0.18, e: 3.2, yc: 0.95 },
  { z: -2.95, w: 0.76, top: 0.29, bot: -0.19, e: 3.2, yc: 0.95 },
  { z: -2.2, w: 0.86, top: 0.34, bot: -0.19, e: 3.2, yc: 0.95 },
  { z: -1.2, w: 0.88, top: 0.35, bot: -0.19, e: 3.2, yc: 0.95 },
  { z: -0.2, w: 0.88, top: 0.34, bot: -0.19, e: 3.2, yc: 0.95 },
  { z: 0.8, w: 0.86, top: 0.325, bot: -0.19, e: 3.2, yc: 0.95 },
  { z: 1.5, w: 0.8, top: 0.29, bot: -0.18, e: 3.2, yc: 0.95 },
  { z: 2.05, w: 0.64, top: 0.175, bot: -0.17, e: 3.2, yc: 0.95 },
];

/* ------------------------------------------------------------------------- */
/* Cockpit                                                                   */
/* ------------------------------------------------------------------------- */

function canopyHoop(profile: HullSection[], z: number, inset: number, tube: number) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 26; i += 1) {
    const sample = surfaceAt(profile, z, i / 26);
    points.push(sample.position.clone().addScaledVector(sample.normal, inset));
  }
  const curve = new THREE.CatmullRomCurve3(points, true);
  return new THREE.TubeGeometry(curve, 48, tube, 5, true);
}

function canopyRail(profile: HullSection[], t: number, z0: number, z1: number, inset: number, tube: number) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const sample = surfaceAt(profile, THREE.MathUtils.lerp(z0, z1, i / 12), t);
    points.push(sample.position.clone().addScaledVector(sample.normal, inset));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, tube, 5, false);
}

interface CockpitBuilt {
  glass: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  dark: THREE.BufferGeometry[];
  black: THREE.BufferGeometry[];
  accent: THREE.BufferGeometry[];
  glowCyan: THREE.BufferGeometry[];
  glowOrange: THREE.BufferGeometry[];
}

export function buildCockpit(): CockpitBuilt {
  const glass: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const black: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const glowCyan: THREE.BufferGeometry[] = [];
  const glowOrange: THREE.BufferGeometry[] = [];

  /* Glazing shell and the fairing it is set into. */
  glass.push(loftGeometry(CANOPY, 1.9, 4.4, { rings: 40, radial: 30 }));
  trim.push(loftGeometry(SILL, 1.9, 4.4, { rings: 24, radial: 26 }));

  /* Canopy frames: hoops, keel rail, shoulder rails, rear hoop. */
  for (const z of [2.06, 2.38, 3.3, 3.98]) {
    const width = z === 2.06 ? 0.055 : 0.034;
    trim.push(
      panelGeometry(CANOPY, z - width, z + width, 0, 1, { rise: 0.024, segZ: 1, segT: 30 }),
    );
  }
  trim.push(
    panelGeometry(CANOPY, 2.12, 4.12, -0.026, 0.026, { rise: 0.03, segZ: 16, segT: 1 }),
  );
  for (const side of [1, -1]) {
    trim.push(
      panelGeometry(CANOPY, 3.32, 4.34, side * 0.158 - 0.013, side * 0.158 + 0.013, {
        rise: 0.026,
        segZ: 8,
        segT: 1,
      }),
    );
  }
  /* Canopy base seal just where the glass leaves the fairing. */
  dark.push(panelGeometry(CANOPY, 2.2, 4.3, 0.4, 0.6, { rise: 0.006, segZ: 12, segT: 2 }));

  /* Sill details: captive fasteners, latches, hinges. */
  for (let i = 0; i < 12; i += 1) {
    const z = 2.0 + i * 0.2;
    for (const side of [1, -1]) {
      const sample = surfaceAt(SILL, z, side * 0.12);
      sample.position.addScaledVector(sample.normal, 0.096);
      placeBolt(trim, sample.position, sample.normal, 0.011);
    }
  }
  for (const side of [1, -1]) {
    const hinge = surfaceAt(SILL, 1.96, side * 0.18);
    const matrix = flatMatrix(
      hinge.position.clone().addScaledVector(hinge.normal, 0.05),
      hinge.normal,
    );
    const bracket = tf(boxGeo(0.1, 0.09, 0.05), 0, 0, 0);
    bracket.applyMatrix4(matrix);
    trim.push(bracket);
    const pin = tf(cylinderGeo(0.018, 0.018, 0.12, 8), 0, 0, 0.035, 0, 0, Math.PI / 2);
    pin.applyMatrix4(matrix);
    dark.push(pin);
    const latch = surfaceAt(SILL, 4.24, side * 0.12);
    latch.position.addScaledVector(latch.normal, 0.085);
    trim.push(placeFlat(boxGeo(0.08, 0.03, 0.05), latch.position, latch.normal));
  }

  /* Aft fairing block bridging to the dorsal spine. */
  dark.push(tf(boxGeo(0.52, 0.3, 0.2), 0, 0.92, 2.0));
  trim.push(tf(boxGeo(0.4, 0.12, 0.12), 0, 1.06, 2.0));

  /* Interior: tub, rear bulkhead, side consoles. */
  dark.push(tf(boxGeo(0.92, 0.05, 2.1), 0, 0.65, 3.05));
  black.push(tf(boxGeo(0.88, 0.5, 0.05), 0, 0.9, 2.16));
  for (const side of [1, -1]) {
    dark.push(tf(boxGeo(0.16, 0.16, 0.9), side * 0.33, 0.78, 3.15, 0, 0, side * 0.18));
    trim.push(tf(boxGeo(0.13, 0.02, 0.82), side * 0.33, 0.865, 3.15, 0, 0, side * 0.18));
    for (let i = 0; i < 4; i += 1) {
      glowCyan.push(
        tf(boxGeo(0.012, 0.012, 0.07), side * 0.33, 0.875, 2.85 + i * 0.17, 0, 0, side * 0.18),
      );
    }
  }

  /* Instrument panel, screens and HUD combiner. */
  dark.push(tf(boxGeo(0.72, 0.24, 0.16), 0, 0.9, 3.92, -0.34, 0, 0));
  trim.push(tf(boxGeo(0.76, 0.03, 0.06), 0, 1.0, 3.88, -0.34, 0, 0));
  for (let i = -1; i <= 1; i += 1) {
    glowCyan.push(tf(boxGeo(0.17, 0.11, 0.006), i * 0.22, 0.93, 3.845, -0.34, 0, 0));
    black.push(tf(boxGeo(0.19, 0.13, 0.01), i * 0.22, 0.93, 3.855, -0.34, 0, 0));
  }
  glass.push(tf(boxGeo(0.3, 0.2, 0.008), 0, 1.1, 3.55, -0.36, 0, 0));
  trim.push(tf(boxGeo(0.32, 0.012, 0.012), 0, 1.2, 3.53, -0.36, 0, 0));
  glowCyan.push(tf(boxGeo(0.02, 0.02, 0.006), 0, 1.21, 3.525, -0.36, 0, 0));

  /* Ejection seat with harness, headrest and survival kit. */
  dark.push(tf(boxGeo(0.46, 0.1, 0.5), 0, 0.8, 2.82));
  trim.push(tf(boxGeo(0.4, 0.06, 0.44), 0, 0.86, 2.82));
  dark.push(tf(boxGeo(0.42, 0.54, 0.14), 0, 1.05, 2.56, -0.14, 0, 0));
  black.push(tf(boxGeo(0.34, 0.4, 0.08), 0, 1.04, 2.63, -0.14, 0, 0));
  dark.push(tf(boxGeo(0.26, 0.17, 0.12), 0, 1.33, 2.5, -0.14, 0, 0));
  for (const side of [1, -1]) {
    dark.push(tf(boxGeo(0.09, 0.2, 0.32), side * 0.23, 0.92, 2.72, -0.14, 0, 0));
    accent.push(tf(boxGeo(0.03, 0.13, 0.05), side * 0.19, 1.2, 2.47, -0.14, 0, 0));
    dark.push(tf(boxGeo(0.07, 0.03, 0.28), side * 0.13, 1.12, 2.72, -0.3, 0, side * 0.08));
    trim.push(tf(boxGeo(0.05, 0.02, 0.03), side * 0.13, 1.06, 2.85, 0, 0, side * 0.08));
  }

  /* Side stick and rudder pedals. */
  dark.push(tf(cylinderGeo(0.02, 0.028, 0.16, 8), 0.3, 0.78, 3.28));
  black.push(tf(boxGeo(0.05, 0.09, 0.05), 0.3, 0.9, 3.28, 0.16, 0, 0));
  accent.push(tf(boxGeo(0.02, 0.02, 0.014), 0.3, 0.945, 3.3));
  for (const side of [1, -1]) {
    dark.push(tf(boxGeo(0.11, 0.03, 0.16), side * 0.2, 0.68, 3.94, 0.22, 0, 0));
  }

  /* Interior structural hoops and cabin lighting. */
  black.push(canopyHoop(CANOPY, 2.52, -0.024, 0.013));
  black.push(canopyHoop(CANOPY, 3.42, -0.024, 0.012));
  black.push(canopyRail(CANOPY, 0, 2.2, 4.0, -0.026, 0.011));
  dark.push(canopyRail(CANOPY, 0.25, 2.15, 3.95, -0.03, 0.009));
  dark.push(canopyRail(CANOPY, -0.25, 2.15, 3.95, -0.03, 0.009));
  glowCyan.push(tf(boxGeo(0.02, 0.012, 0.55), 0, 1.3, 2.85));
  glowCyan.push(tf(boxGeo(0.06, 0.012, 0.02), 0, 0.9, 3.44));

  /* Exterior service markings hardware: rescue panel on the sill. */
  const rescue = surfaceAt(SILL, 2.9, 0.36);
  rescue.position.addScaledVector(rescue.normal, 0.06);
  const matrix = flatMatrix(rescue.position, rescue.normal);
  const frame = ringFrameGeometry(0.2, 0.14, 0.03, 0.018, 0.012);
  frame.applyMatrix4(matrix);
  trim.push(frame);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const local = new THREE.Vector3(sx * 0.075, sy * 0.05, 0.016);
      placeBolt(trim, local.clone().applyMatrix4(matrix), rescue.normal, 0.008);
    }
  }

  /* Canopy edge frame at the front tip. */
  trim.push(tf(boxGeo(0.3, 0.03, 0.08), 0, 1.02, 4.34, -0.2, 0, 0));
  dark.push(tf(boxGeo(0.06, 0.014, 0.2), 0.12, 1.08, 4.1, -0.5, 0, 0));

  return { glass, trim, dark, black, accent, glowCyan, glowOrange };
}

function cockpitStencils(): StencilPlacement[] {
  const rescue = makeDecalTexture(['RESCUE'], { width: 512, height: 160, align: 'center' });
  const eject = makeDecalTexture(['EJECTION SEAT', 'DO NOT BLOCK'], {
    width: 512,
    height: 224,
  });
  const number = makeDecalTexture(['03', 'COCKPIT'], { width: 512, height: 224, align: 'center' });

  const at = (z: number, t: number, lift: number, width: number, height: number) => {
    const sample = surfaceAt(SILL, z, t);
    return {
      position: vec(sample.position.clone().addScaledVector(sample.normal, lift)),
      normal: vec(sample.normal),
      width,
      height,
    };
  };

  return [
    { key: 'cockpit-rescue', texture: rescue, ...at(3.35, 0.3, 0.06, 0.4, 0.13) },
    { key: 'cockpit-eject', texture: eject, ...at(2.25, 0.34, 0.06, 0.5, 0.22) },
    { key: 'cockpit-number', texture: number, ...at(3.95, -0.24, 0.06, 0.42, 0.18) },
  ];
}

export function Cockpit() {
  const materials = useShipMaterials();
  const built = useMemo(buildCockpit, []);
  const stencils = useMemo(cockpitStencils, []);

  return (
    <group name="cockpit-module">
      <Merged geos={built.glass} material={materials.glass} cast={false} />
      <Merged geos={built.trim} material={materials.trim} />
      <Merged geos={built.dark} material={materials.dark} />
      <Merged geos={built.black} material={materials.black} />
      <Merged geos={built.accent} material={materials.accent} />
      <Merged geos={built.glowCyan} material={materials.glowCyan} cast={false} receive={false} />
      <Merged geos={built.glowOrange} material={materials.glowOrange} cast={false} receive={false} />
      {stencils.map(({ key, ...rest }) => (
        <Stencil key={key} {...rest} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------------- */
/* Dorsal spine                                                              */
/* ------------------------------------------------------------------------- */

function addDorsalVent(
  housing: THREE.BufferGeometry[],
  fins: THREE.BufferGeometry[],
  zCenter: number,
  tCenter: number,
  zLength: number,
  tWidth: number,
  finCount: number,
) {
  housing.push(
    panelGeometry(
      DORSAL,
      zCenter - zLength / 2,
      zCenter + zLength / 2,
      tCenter - tWidth / 2,
      tCenter + tWidth / 2,
      { rise: 0.02, segZ: 4, segT: 3 },
    ),
  );
  for (let i = 0; i < finCount; i += 1) {
    const t = tCenter - tWidth / 2 + (tWidth * (i + 0.5)) / finCount;
    const sample = surfaceAt(DORSAL, zCenter, t);
    sample.position.addScaledVector(sample.normal, 0.028);
    fins.push(
      placeFlat(boxGeo(zLength * 0.84, (tWidth / finCount) * 0.5, 0.03), sample.position, sample.normal),
    );
  }
}

interface DorsalBuilt {
  casing: THREE.BufferGeometry[];
  hull: THREE.BufferGeometry[];
  ceramic: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  dark: THREE.BufferGeometry[];
  black: THREE.BufferGeometry[];
  accent: THREE.BufferGeometry[];
  glowCyan: THREE.BufferGeometry[];
}

export function buildDorsal(): DorsalBuilt {
  const casing: THREE.BufferGeometry[] = [];
  const hull: THREE.BufferGeometry[] = [];
  const ceramic: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const black: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const glowCyan: THREE.BufferGeometry[] = [];

  casing.push(loftGeometry(DORSAL, -3.7, 2.05, { rings: 30, radial: 28 }));

  /* Detachable top armour panels with exposed fasteners. */
  const topSpans: [number, number][] = [
    [-3.35, -2.25],
    [-2.15, -1.05],
    [-0.95, 0.25],
    [0.35, 1.55],
  ];
  for (const [z0, z1] of topSpans) {
    hull.push(panelGeometry(DORSAL, z0, z1, -0.15, 0.15, { rise: 0.03, segZ: 4, segT: 5 }));
    for (const z of [z0 + 0.1, z1 - 0.1]) {
      for (const t of [-0.12, 0.12]) {
        const sample = surfaceAt(DORSAL, z, t);
        sample.position.addScaledVector(sample.normal, 0.034);
        placeBolt(trim, sample.position, sample.normal, 0.011);
      }
    }
    /* Lift points and pull handles follow the crown of the panel. */
    const crown = surfaceAt(DORSAL, (z0 + z1) / 2, 0);
    const crownTop = crown.position.clone().addScaledVector(crown.normal, 0.036);
    trim.push(placeFlat(boxGeo(0.09, 0.12, 0.022), crownTop, crown.normal));
    for (const side of [1, -1]) {
      const eye = surfaceAt(DORSAL, (z0 + z1) / 2, side * 0.085);
      eye.position.addScaledVector(eye.normal, 0.034);
      dark.push(
        placeFlat(new THREE.TorusGeometry(0.024, 0.006, 5, 12), eye.position, eye.normal),
      );
    }
  }

  /* Side armour rows. */
  for (const side of [1, -1]) {
    const spans: [number, number][] = [
      [-3.3, -2.2],
      [-2.1, -0.9],
      [-0.8, 0.5],
      [0.6, 1.7],
    ];
    for (const [z0, z1] of spans) {
      hull.push(
        panelGeometry(DORSAL, z0, z1, side * 0.16, side * 0.27, { rise: 0.022, segZ: 3, segT: 3 }),
      );
      for (const z of [z0 + 0.15, z1 - 0.15]) {
        const sample = surfaceAt(DORSAL, z, side * 0.245);
        sample.position.addScaledVector(sample.normal, 0.026);
        placeBolt(trim, sample.position, sample.normal, 0.009);
      }
    }
    /* Edge rails along the panel seams. */
    trim.push(
      panelGeometry(DORSAL, -3.45, 1.9, side * 0.148 - 0.011, side * 0.148 + 0.011, {
        rise: 0.042,
        segZ: 18,
        segT: 1,
      }),
    );
    for (let i = 0; i < 7; i += 1) {
      const z = -3.3 + i * 0.82;
      const sample = surfaceAt(DORSAL, z, side * 0.148);
      sample.position.addScaledVector(sample.normal, 0.05);
      placeBolt(trim, sample.position, sample.normal, 0.009);
    }
  }

  /* Heat exchangers on both flanks. */
  for (const side of [1, -1]) {
    addDorsalVent(dark, trim, -2.35, side * 0.325, 1.0, 0.075, 8);
    addDorsalVent(dark, trim, -1.25, side * 0.325, 0.55, 0.06, 5);
    const duct = surfaceAt(DORSAL, -2.9, side * 0.31);
    duct.position.addScaledVector(duct.normal, 0.018);
    dark.push(placeFlat(boxGeo(0.18, 0.1, 0.07), duct.position, duct.normal));
  }

  /* Front bulkhead: connector face mates with the cockpit aft fairing. */
  dark.push(tf(boxGeo(0.52, 0.2, 0.08), 0, 0.9, 2.0, 0.2, 0, 0));
  trim.push(tf(boxGeo(0.44, 0.12, 0.03), 0, 0.92, 2.055, 0.2, 0, 0));
  for (const side of [1, -1]) {
    dark.push(
      placeAlong(
        cylinderGeo(0.036, 0.036, 0.05, 12),
        new THREE.Vector3(side * 0.13, 0.9, 2.07),
        new THREE.Vector3(0, 0.34, 1).normalize(),
      ),
    );
    trim.push(
      placeAlong(
        new THREE.TorusGeometry(0.038, 0.006, 5, 14),
        new THREE.Vector3(side * 0.13, 0.912, 2.088),
        new THREE.Vector3(0, 0.34, 1).normalize(),
      ),
    );
    glowCyan.push(
      placeFlat(
        new THREE.TorusGeometry(0.015, 0.005, 5, 10),
        new THREE.Vector3(side * 0.13, 1.0, 2.06),
        new THREE.Vector3(0, 0.34, 1).normalize(),
      ),
    );
  }

  /* Rear grille and thrusters on the aft face of the spine. */
  dark.push(tf(boxGeo(0.4, 0.22, 0.05), 0, 1.0, -3.705, -0.2, 0, 0));
  for (let i = 0; i < 6; i += 1) {
    trim.push(tf(boxGeo(0.38, 0.016, 0.02), 0, 0.91 + i * 0.038, -3.728, -0.2, 0, 0));
  }
  for (const side of [1, -1]) {
    for (let i = 0; i < 2; i += 1) {
      const port = surfaceAt(DORSAL, -3.45, side * (0.14 + i * 0.06));
      port.position.addScaledVector(port.normal, 0.012);
      dark.push(placeAlong(cylinderGeo(0.028, 0.032, 0.03, 10), port.position, port.normal));
      trim.push(
        placeFlat(
          new THREE.TorusGeometry(0.03, 0.006, 5, 12),
          port.position.clone().addScaledVector(port.normal, 0.018),
          port.normal,
        ),
      );
    }
  }

  /* Conduit run and low profile comm antenna. */
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 14; i += 1) {
    const sample = surfaceAt(DORSAL, -3.4 + i * 0.36, 0.34);
    points.push(sample.position.clone().addScaledVector(sample.normal, 0.012));
  }
  trim.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.014, 6, false));
  for (let i = 0; i < 5; i += 1) {
    const sample = surfaceAt(DORSAL, -3.3 + i * 0.95, 0.34);
    sample.position.addScaledVector(sample.normal, 0.012);
    dark.push(placeFlat(boxGeo(0.05, 0.05, 0.04), sample.position, sample.normal));
  }
  trim.push(tf(boxGeo(0.02, 0.05, 0.3), 0.28, 1.32, -3.0, 0.12, 0, -0.16));
  dark.push(tf(boxGeo(0.04, 0.03, 0.06), 0.28, 1.3, -3.14));

  /* Fastener rows along the panel gaps keep the spine readable up close. */
  for (let i = 0; i < 9; i += 1) {
    const z = -3.4 + i * 0.62;
    const sample = surfaceAt(DORSAL, z, 0);
    sample.position.addScaledVector(sample.normal, 0.036);
    black.push(placeFlat(boxGeo(0.02, 0.02, 0.02), sample.position, sample.normal));
  }

  return { casing, hull, ceramic, trim, dark, black, accent, glowCyan };
}

function dorsalStencils(): StencilPlacement[] {
  const spine = makeDecalTexture(['DORSAL SPINE', 'DETACHABLE ARMOUR'], {
    width: 768,
    height: 224,
  });
  const number = makeDecalTexture(['04', 'HEAT EXCHANGER'], { width: 512, height: 256 });
  const atTop = surfaceAt(DORSAL, -0.35, 0.06);
  return [
    {
      key: 'dorsal-side',
      texture: spine,
      position: vec(
        surfaceAt(DORSAL, 0.0, 0.245).position
          .clone()
          .addScaledVector(surfaceAt(DORSAL, 0.0, 0.245).normal, 0.03),
      ),
      normal: vec(surfaceAt(DORSAL, 0.0, 0.245).normal),
      width: 0.7,
      height: 0.22,
    },
    {
      key: 'dorsal-top',
      texture: number,
      position: vec(atTop.position.clone().addScaledVector(atTop.normal, 0.036)),
      normal: vec(atTop.normal),
      width: 0.5,
      height: 0.25,
      up: [0, 0, 1],
    },
  ];
}

export function DorsalSpine() {
  const materials = useShipMaterials();
  const built = useMemo(buildDorsal, []);
  const stencils = useMemo(dorsalStencils, []);

  return (
    <group name="dorsal-spine">
      <Merged geos={built.casing} material={materials.dark} />
      <Merged geos={built.hull} material={materials.hull} />
      <Merged geos={built.ceramic} material={materials.ceramic} />
      <Merged geos={built.trim} material={materials.trim} />
      <Merged geos={built.dark} material={materials.dark} />
      <Merged geos={built.black} material={materials.black} />
      <Merged geos={built.accent} material={materials.accent} />
      <Merged geos={built.glowCyan} material={materials.glowCyan} cast={false} receive={false} />
      {stencils.map(({ key, ...rest }) => (
        <Stencil key={key} {...rest} />
      ))}
    </group>
  );
}
