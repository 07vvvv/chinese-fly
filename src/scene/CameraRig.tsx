import { useEffect, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useShip } from '../state/ship';

type Pose = { position: THREE.Vector3; target: THREE.Vector3 };

function getPose(exploded: boolean, width: number, weapon: boolean): Pose {
  const portrait = width < 760;
  const compact = width < 1200;
  const scale = portrait ? 1.52 : compact ? 1.16 : 1;
  const target = exploded ? new THREE.Vector3(0, 0.85, -1.3) : new THREE.Vector3(0, 0.18, 0);

  if (exploded) {
    return {
      position: new THREE.Vector3(18.2, 9.4, 23.0).multiplyScalar(scale),
      target,
    };
  }

  if (weapon && !portrait) {
    // Weapon test camera: a high three-quarter orbit separates both beams from
    // the wing lines and shows the twin cannon convergence.
    const distance = 24.5 * scale;
    const polar = THREE.MathUtils.degToRad(54);
    const azimuth = THREE.MathUtils.degToRad(96);
    return {
      position: new THREE.Vector3(
        target.x + distance * Math.sin(polar) * Math.sin(azimuth),
        target.y + distance * Math.cos(polar),
        target.z + distance * Math.sin(polar) * Math.cos(azimuth),
      ),
      target,
    };
  }

  if (portrait) {
    return {
      position: new THREE.Vector3(11.8, 5.35, 13.9).multiplyScalar(scale),
      target,
    };
  }

  // Rear-three-quarter hero angle: shows the canopy and forward fuselage while
  // keeping both engine plumes in frame.
  const distance = 20.5 * scale;
  const polar = THREE.MathUtils.degToRad(71);
  const azimuth = THREE.MathUtils.degToRad(75);
  return {
    position: new THREE.Vector3(
      target.x + distance * Math.sin(polar) * Math.sin(azimuth),
      target.y + distance * Math.cos(polar),
      target.z + distance * Math.sin(polar) * Math.cos(azimuth),
    ),
    target,
  };
}

type CameraAnimation = {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  elapsed: number;
  duration: number;
};

export function CameraRig() {
  const { camera, size } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const animation = useRef<CameraAnimation | null>(null);
  const introPlayed = useRef(false);
  const { exploded, sceneReady, reducedMotion, selected, weapon } = useShip();

  useEffect(() => {
    if (!controls.current) return;

    if (!sceneReady) {
      controls.current.enabled = false;
      return;
    }

    const pose = getPose(exploded, size.width, weapon);
    const currentTarget = controls.current.target.clone();

    if (!introPlayed.current) {
      introPlayed.current = true;
      camera.position.copy(pose.position).multiplyScalar(1.14);
      camera.position.y += 1.25;
      controls.current.target.copy(pose.target).add(new THREE.Vector3(0, 0.4, 0));
      controls.current.enabled = false;
      animation.current = {
        fromPosition: camera.position.clone(),
        toPosition: pose.position,
        fromTarget: controls.current.target.clone(),
        toTarget: pose.target,
        elapsed: 0,
        duration: reducedMotion ? 0.01 : 2.6,
      };
      return;
    }

    controls.current.enabled = false;
    animation.current = {
      fromPosition: camera.position.clone(),
      toPosition: pose.position,
      fromTarget: currentTarget,
      toTarget: pose.target,
      elapsed: 0,
      duration: reducedMotion ? 0.01 : 1.35,
    };
  }, [camera, exploded, reducedMotion, sceneReady, size.width, weapon]);

  useEffect(() => {
    const control = controls.current;
    if (!control) return;
    control.autoRotate = !exploded && !selected && !weapon;
  }, [exploded, selected, weapon]);

  // Deterministic camera access for automated visual QA.
  useEffect(() => {
    const api = {
      setView: (azimuthDeg: number, polarDeg: number, distance: number) => {
        const control = controls.current;
        const target = control?.target.clone() ?? new THREE.Vector3(0, 0.18, 0);
        const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
        const polar = THREE.MathUtils.degToRad(polarDeg);
        const position = new THREE.Vector3(
          target.x + distance * Math.sin(polar) * Math.sin(azimuth),
          target.y + distance * Math.cos(polar),
          target.z + distance * Math.sin(polar) * Math.cos(azimuth),
        );
        animation.current = null;
        camera.position.copy(position);
        if (control) {
          control.target.copy(target);
          control.update();
        }
        camera.lookAt(target);
      },
    };
    (window as unknown as { __HELIOS_CAM__?: typeof api }).__HELIOS_CAM__ = api;
    return () => {
      delete (window as unknown as { __HELIOS_CAM__?: typeof api }).__HELIOS_CAM__;
    };
  }, [camera]);

  useFrame((_, delta) => {
    const control = controls.current;
    const active = animation.current;
    if (!control) return;

    if (active) {
      active.elapsed += Math.min(delta, 0.05);
      const raw = Math.min(active.elapsed / active.duration, 1);
      const eased = 1 - Math.pow(1 - raw, 4);
      camera.position.lerpVectors(active.fromPosition, active.toPosition, eased);
      control.target.lerpVectors(active.fromTarget, active.toTarget, eased);
      camera.lookAt(control.target);
      control.update();

      if (raw >= 1) {
        animation.current = null;
        camera.position.copy(active.toPosition);
        control.target.copy(active.toTarget);
        camera.lookAt(control.target);
        control.enabled = true;
      }
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.055}
      rotateSpeed={0.52}
      zoomSpeed={0.72}
      minDistance={7}
      maxDistance={55}
      minPolarAngle={0.18}
      maxPolarAngle={Math.PI * 0.68}
      autoRotateSpeed={0.24}
      target={[0, 0.18, 0]}
      onStart={() => {
        animation.current = null;
        if (controls.current) controls.current.enabled = true;
      }}
    />
  );
}
