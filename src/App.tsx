import { Suspense, useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import * as THREE from 'three';
import { ShipProvider, useShip } from './state/ship';
import { Environment } from './scene/Environment';
import { Ship } from './scene/Ship';
import { Post } from './scene/Post';
import { CameraRig } from './scene/CameraRig';
import { Hud } from './ui/Hud';
import './styles/base.css';

function Scene() {
  const { markSceneReady, setSelected } = useShip();
  const created = useRef(false);

  const handleCreated = useCallback(
    ({ gl }: { gl: THREE.WebGLRenderer }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.02;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      if (!created.current) {
        created.current = true;
        (window as unknown as { __HELIOS_READY__?: boolean }).__HELIOS_READY__ = true;
        (window as unknown as { __HELIOS_GL__?: THREE.WebGLRenderer }).__HELIOS_GL__ = gl;
        markSceneReady();
      }
    },
    [markSceneReady],
  );

  const handleMissed = useCallback(() => {
    setSelected(null);
  }, [setSelected]);

  return (
    <Canvas
      className="scene-canvas"
      dpr={[1, 1.75]}
      shadows
      camera={{ fov: 38, near: 0.1, far: 220, position: [15.5, 7.2, 18.5] }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        logarithmicDepthBuffer: false,
      }}
      onCreated={handleCreated}
      onPointerMissed={handleMissed}
      resize={{ scroll: false, debounce: { scroll: 50, resize: 120 } }}
    >
      <color attach="background" args={['#03060a']} />
      <Suspense fallback={null}>
        <Environment />
        <Ship />
        <CameraRig />
        <Post />
        <Preload all />
      </Suspense>
      <AdaptiveDpr pixelated />
    </Canvas>
  );
}

export default function App() {
  return (
    <ShipProvider>
      <main className="app-shell">
        <Scene />
        <Hud />
        <div className="screen-grain" aria-hidden="true" />
        <div className="screen-vignette" aria-hidden="true" />
      </main>
    </ShipProvider>
  );
}
