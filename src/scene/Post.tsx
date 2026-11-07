import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { Vector2 } from 'three';

/**
 * HELIOS-9 post pipeline.
 *
 * The composer disables the renderer's tone mapping, so ACES is applied once,
 * explicitly, at the end of the chain. Bloom therefore works on linear HDR
 * values and film grain lands after tone mapping, where it reads best.
 * Effects are deliberately restrained: the HUD and part labels live in the DOM
 * above the canvas and must keep their contrast.
 */
export function Post() {
  const size = useThree((state) => state.size);
  const compact = size.width < 820;

  const aberration = useMemo(
    () => new Vector2(compact ? 0.00032 : 0.00055, compact ? 0.0004 : 0.00072),
    [compact],
  );

  return (
    <EffectComposer multisampling={compact ? 2 : 4} renderPriority={1}>
      <Bloom
        intensity={0.5}
        luminanceThreshold={0.87}
        luminanceSmoothing={0.32}
        mipmapBlur
        radius={0.62}
        levels={compact ? 4 : 6}
      />
      <ChromaticAberration
        blendFunction={BlendFunction.NORMAL}
        offset={aberration}
        radialModulation
        modulationOffset={0.38}
      />
      <Vignette blendFunction={BlendFunction.NORMAL} offset={0.2} darkness={0.4} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Noise blendFunction={BlendFunction.OVERLAY} premultiply opacity={0.03} />
    </EffectComposer>
  );
}
