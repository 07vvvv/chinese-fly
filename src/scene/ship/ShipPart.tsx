import React, { useEffect, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PART_MAP, type PartId } from '../../data/ship';
import { useShip } from '../../state/ship';
import './PartLabel.css';

const scratch = new THREE.Vector3();
const zero = new THREE.Vector3();
const tempOffset = new THREE.Vector3();

function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function PartLabel({ id }: { id: PartId }) {
  const def = PART_MAP[id];
  const { selected, hovered, exploded, labels } = useShip();
  const active = selected === id || hovered === id;
  const visible = (exploded && labels) || active;
  const dimmed = selected !== null && selected !== id;

  if (!visible) return null;

  return (
    <Html
      position={def.anchor}
      center
      zIndexRange={[30, 10]}
      style={{ pointerEvents: 'none' }}
      wrapperClass="part-label-wrapper"
    >
      <div
        className={[
          'part-label',
          active ? 'is-active' : '',
          dimmed ? 'is-dimmed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="part-label__index">{def.index}</span>
        <span className="part-label__line" aria-hidden="true" />
        <span className="part-label__copy">
          <span className="part-label__name">{def.name}</span>
          <span className="part-label__en">{def.nameEn}</span>
        </span>
      </div>
    </Html>
  );
}

export function ShipPart({ id, children }: { id: PartId; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const def = PART_MAP[id];
  const { exploded, reducedMotion, hovered, selected, setHovered, setSelected } = useShip();
  const active = hovered === id || selected === id;

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
    };
  }, []);

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;

    const clampedDelta = Math.min(delta, 0.05);
    const target = exploded ? 1 : 0;
    progress.current = THREE.MathUtils.damp(
      progress.current,
      target,
      reducedMotion ? 14 : 3.1,
      clampedDelta,
    );

    const start = def.delay * 0.32;
    const local = THREE.MathUtils.clamp((progress.current - start) / (1 - start), 0, 1);
    const eased = easeInOutCubic(local);

    tempOffset.set(def.offset[0], def.offset[1], def.offset[2]).multiplyScalar(eased);
    scratch.copy(tempOffset);
    if (active) scratch.y += 0.055 * (1 - eased);
    node.position.copy(scratch);

    // Slight physical banking keeps the exploded diagram from feeling like a
    // pure translation diagram.
    node.rotation.z = def.offset[0] * 0.0085 * eased;
    node.rotation.y = -def.offset[2] * 0.0022 * eased;
    node.rotation.x = Math.abs(def.offset[0]) * 0.002 * eased;
  });

  return (
    <group
      ref={group}
      name={`part-${id}`}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(id);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHovered(null);
        document.body.style.cursor = '';
      }}
      onClick={(event) => {
        event.stopPropagation();
        setSelected(selected === id ? null : id);
        document.body.style.cursor = '';
      }}
    >
      {children}
      <PartLabel id={id} />
    </group>
  );
}
