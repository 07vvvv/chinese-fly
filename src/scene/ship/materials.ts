import * as THREE from 'three';
import { useMemo } from 'react';

export interface ShipMaterials {
  hull: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  black: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  core: THREE.MeshStandardMaterial;
  glowCyan: THREE.MeshStandardMaterial;
  glowOrange: THREE.MeshStandardMaterial;
}

type PanelTextures = {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
};

let panelTextureCache: PanelTextures | null = null;

function rand(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function createPanelTextures(): PanelTextures {
  if (panelTextureCache) return panelTextureCache;

  const size = 1024;
  const mapCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  mapCanvas.width = mapCanvas.height = size;
  roughCanvas.width = roughCanvas.height = size;
  bumpCanvas.width = bumpCanvas.height = size;

  const mapCtx = mapCanvas.getContext('2d')!;
  const roughCtx = roughCanvas.getContext('2d')!;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const random = rand(97);

  mapCtx.fillStyle = '#b9c1c8';
  mapCtx.fillRect(0, 0, size, size);
  roughCtx.fillStyle = '#8a8a8a';
  roughCtx.fillRect(0, 0, size, size);
  bumpCtx.fillStyle = '#808080';
  bumpCtx.fillRect(0, 0, size, size);

  // Irregular armor panel atlas. Values are intentionally subtle: at ship scale
  // these read as brushing/panel variation rather than a camo pattern.
  const cols = 8;
  const rows = 10;
  const cellW = size / cols;
  const cellH = size / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const inset = 3 + random() * 8;
      const x = col * cellW + inset;
      const y = row * cellH + inset;
      const w = cellW - inset * 2 - random() * 10;
      const h = cellH - inset * 2 - random() * 10;
      const lightness = 173 + Math.floor(random() * 30);
      mapCtx.fillStyle = `rgb(${lightness}, ${lightness + 5}, ${lightness + 10})`;
      mapCtx.globalAlpha = 0.35;
      mapCtx.fillRect(x, y, w, h);
      mapCtx.globalAlpha = 1;

      const rough = 118 + Math.floor(random() * 42);
      roughCtx.fillStyle = `rgb(${rough}, ${rough}, ${rough})`;
      roughCtx.fillRect(x, y, w, h);

      bumpCtx.fillStyle = '#858585';
      bumpCtx.fillRect(x, y, w, h);
    }
  }

  // Long seam lines and thinner panel cuts.
  const seams = 46;
  for (let i = 0; i < seams; i += 1) {
    const vertical = random() > 0.5;
    const pos = Math.floor(random() * size);
    mapCtx.strokeStyle = `rgba(48, 56, 63, ${0.28 + random() * 0.2})`;
    mapCtx.lineWidth = 1 + Math.floor(random() * 2);
    roughCtx.strokeStyle = 'rgba(36, 36, 36, 0.85)';
    roughCtx.lineWidth = 2;
    bumpCtx.strokeStyle = 'rgba(38, 38, 38, 0.9)';
    bumpCtx.lineWidth = 2;

    [mapCtx, roughCtx, bumpCtx].forEach((ctx) => {
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(pos + 0.5, 0);
        ctx.lineTo(pos + 0.5, size);
      } else {
        ctx.moveTo(0, pos + 0.5);
        ctx.lineTo(size, pos + 0.5);
      }
      ctx.stroke();
    });
  }

  // Rivets / fasteners.
  for (let i = 0; i < 900; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = 0.7 + random() * 1.5;
    mapCtx.fillStyle = 'rgba(39, 46, 52, 0.55)';
    mapCtx.beginPath();
    mapCtx.arc(x, y, radius, 0, Math.PI * 2);
    mapCtx.fill();
    bumpCtx.fillStyle = 'rgba(205, 205, 205, 0.7)';
    bumpCtx.beginPath();
    bumpCtx.arc(x, y, radius * 0.85, 0, Math.PI * 2);
    bumpCtx.fill();
  }

  // Fine scratches and oxidation flecks.
  for (let i = 0; i < 240; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const length = 4 + random() * 40;
    mapCtx.strokeStyle = `rgba(70, 78, 86, ${0.12 + random() * 0.18})`;
    mapCtx.lineWidth = 0.6 + random() * 1.1;
    mapCtx.beginPath();
    mapCtx.moveTo(x, y);
    mapCtx.lineTo(x + length, y + (random() - 0.5) * 8);
    mapCtx.stroke();
    bumpCtx.strokeStyle = 'rgba(58, 58, 58, 0.6)';
    bumpCtx.lineWidth = 1;
    bumpCtx.beginPath();
    bumpCtx.moveTo(x, y);
    bumpCtx.lineTo(x + length, y + (random() - 0.5) * 8);
    bumpCtx.stroke();
  }

  const map = new THREE.CanvasTexture(mapCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);

  [map, roughnessMap, bumpMap].forEach((texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.2, 2.2);
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  });

  panelTextureCache = { map, roughnessMap, bumpMap };
  return panelTextureCache;
}

export function useShipMaterials(): ShipMaterials {
  return useMemo(() => {
    const { map, roughnessMap, bumpMap } = createPanelTextures();

    const hull = new THREE.MeshStandardMaterial({
      color: '#aeb8c1',
      map,
      roughnessMap,
      bumpMap,
      bumpScale: 0.018,
      metalness: 0.72,
      roughness: 0.48,
      envMapIntensity: 1.15,
    });

    const dark = new THREE.MeshStandardMaterial({
      color: '#1b232b',
      metalness: 0.82,
      roughness: 0.34,
      envMapIntensity: 1.05,
    });

    const trim = new THREE.MeshStandardMaterial({
      color: '#485763',
      metalness: 0.92,
      roughness: 0.26,
      envMapIntensity: 1.3,
    });

    const ceramic = new THREE.MeshStandardMaterial({
      color: '#d3cec0',
      metalness: 0.08,
      roughness: 0.55,
      envMapIntensity: 0.75,
    });

    const accent = new THREE.MeshStandardMaterial({
      color: '#c46227',
      metalness: 0.25,
      roughness: 0.44,
      envMapIntensity: 0.9,
    });

    const glass = new THREE.MeshPhysicalMaterial({
      color: '#07151d',
      metalness: 0.08,
      roughness: 0.06,
      transmission: 0.42,
      thickness: 0.9,
      ior: 1.46,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.78,
      envMapIntensity: 2.1,
      side: THREE.DoubleSide,
    });

    const black = new THREE.MeshStandardMaterial({
      color: '#05080b',
      metalness: 0.55,
      roughness: 0.62,
    });

    const rubber = new THREE.MeshStandardMaterial({
      color: '#0d1115',
      metalness: 0.05,
      roughness: 0.88,
    });

    const core = new THREE.MeshStandardMaterial({
      color: '#ffe1b0',
      emissive: '#ff6a1f',
      emissiveIntensity: 4,
      metalness: 0.2,
      roughness: 0.22,
      toneMapped: false,
    });

    const glowCyan = new THREE.MeshStandardMaterial({
      color: '#bffaff',
      emissive: '#5fe7f2',
      emissiveIntensity: 3.4,
      metalness: 0.1,
      roughness: 0.2,
      toneMapped: false,
    });

    const glowOrange = new THREE.MeshStandardMaterial({
      color: '#ffd8b0',
      emissive: '#ff6b1f',
      emissiveIntensity: 4.2,
      metalness: 0.1,
      roughness: 0.2,
      toneMapped: false,
    });

    return { hull, dark, trim, ceramic, accent, glass, black, rubber, core, glowCyan, glowOrange };
  }, []);
}

export interface DecalOptions {
  width?: number;
  height?: number;
  color?: string;
  background?: string;
  accent?: string;
  align?: 'left' | 'center' | 'right';
}

/**
 * Crisp procedural stencil/decal texture. Transparent background by default.
 * Use on a slightly offset plane with polygonOffset to avoid z-fighting.
 */
export function makeDecalTexture(lines: string[], opts: DecalOptions = {}): THREE.CanvasTexture {
  const width = opts.width ?? 512;
  const height = opts.height ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);
  }

  const color = opts.color ?? '#d8e2e6';
  const accent = opts.accent ?? '#5fe7f2';
  const align = opts.align ?? 'left';
  const x = align === 'left' ? width * 0.06 : align === 'right' ? width * 0.94 : width * 0.5;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const count = Math.max(1, lines.length);
  const fontSize = Math.min(height / (count * 1.38), width / 9);
  ctx.font = `700 ${fontSize}px Bahnschrift, "Arial Narrow", sans-serif`;
  ctx.fillStyle = color;
  lines.forEach((line, index) => {
    const y = height * 0.5 + (index - (count - 1) / 2) * fontSize * 1.28;
    ctx.fillText(line, x, y);
  });

  // Small accent slash for visual identity.
  ctx.fillStyle = accent;
  ctx.fillRect(align === 'right' ? width * 0.82 : width * 0.06, height * 0.84, width * 0.12, 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
