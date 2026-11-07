import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useShip } from '../state/ship';
import { ShipPart } from './ship/ShipPart';
import { Fuselage, NoseArray } from './ship/parts/fuselage';
import { Cockpit, DorsalSpine } from './ship/parts/cockpit';
import { FusionCore, BellyPod } from './ship/parts/internals';
import { Wing } from './ship/parts/wings';
import { TailFin } from './ship/parts/tailfin';
import { Engine } from './ship/parts/engines';
import { LaserFX } from './effects/LaserFX';

export function Ship() {
  const root = useRef<THREE.Group>(null);
  const { reducedMotion, exploded } = useShip();
  const floatAmount = useRef(1);

  useFrame(({ clock }, delta) => {
    const node = root.current;
    if (!node) return;

    const elapsed = clock.getElapsedTime();
    const target = exploded ? 0.18 : 1;
    floatAmount.current = THREE.MathUtils.damp(
      floatAmount.current,
      target,
      2.2,
      Math.min(delta, 0.05),
    );
    const amount = reducedMotion ? 0 : floatAmount.current;
    node.position.y = Math.sin(elapsed * 0.55) * 0.045 * amount;
    node.rotation.z = Math.sin(elapsed * 0.37) * 0.0045 * amount;
    node.rotation.x = Math.sin(elapsed * 0.29 + 1.2) * 0.0025 * amount;
  });

  return (
    <>
      {/* Exploded-view fill: recovers the camera-facing sides of separated
          modules without touching the assembled hero lighting. */}
      <directionalLight
        position={[10, 7, 14]}
        intensity={exploded ? 0.72 : 0}
        color="#d8edf7"
      />
      <directionalLight
        position={[-12, 5, -8]}
        intensity={exploded ? 0.22 : 0}
        color="#5fe7f2"
      />
      <group ref={root} name="helios-9">
        <ShipPart id="hull">
          <Fuselage />
        </ShipPart>
        <ShipPart id="nose">
          <NoseArray />
        </ShipPart>
        <ShipPart id="canopy">
          <Cockpit />
        </ShipPart>
        <ShipPart id="dorsal">
          <DorsalSpine />
        </ShipPart>
        <ShipPart id="core">
          <FusionCore />
        </ShipPart>
        <ShipPart id="wingL">
          <Wing side="L" />
        </ShipPart>
        <ShipPart id="wingR">
          <Wing side="R" />
        </ShipPart>
        <ShipPart id="engineL">
          <Engine side="L" />
        </ShipPart>
        <ShipPart id="engineR">
          <Engine side="R" />
        </ShipPart>
        <ShipPart id="fin">
          <TailFin />
        </ShipPart>
        <ShipPart id="belly">
          <BellyPod />
        </ShipPart>
        <LaserFX />
      </group>
    </>
  );
}
