import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { PartId } from '../data/ship';

export type PowerMode = 'standby' | 'ignition';

export interface ShipContextValue {
  exploded: boolean;
  toggleExploded: () => void;
  setExploded: (value: boolean) => void;
  labels: boolean;
  toggleLabels: () => void;
  hovered: PartId | null;
  setHovered: (id: PartId | null) => void;
  selected: PartId | null;
  setSelected: (id: PartId | null) => void;
  power: PowerMode;
  togglePower: () => void;
  weapon: boolean;
  toggleWeapon: () => void;
  sceneReady: boolean;
  markSceneReady: () => void;
  reducedMotion: boolean;
}

const ShipContext = createContext<ShipContextValue | null>(null);

function getReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ShipProvider({ children }: { children: React.ReactNode }) {
  const [exploded, setExplodedState] = useState(false);
  const [labels, setLabels] = useState(true);
  const [hovered, setHovered] = useState<PartId | null>(null);
  const [selected, setSelected] = useState<PartId | null>(null);
  const [power, setPower] = useState<PowerMode>('standby');
  const [weapon, setWeapon] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(getReducedMotion);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  const setExploded = useCallback((value: boolean) => {
    setExplodedState(value);
    if (value) setWeapon(false);
  }, []);

  const toggleExploded = useCallback(() => {
    setExplodedState((current) => {
      if (!current) setWeapon(false);
      return !current;
    });
  }, []);

  const toggleLabels = useCallback(() => setLabels((value) => !value), []);
  const togglePower = useCallback(() => {
    setPower((value) => {
      if (value === 'standby') {
        // Weapon test and afterburner share the same power budget. Keep the
        // demo legible by interlocking the two modes.
        setWeapon(false);
        return 'ignition';
      }
      return 'standby';
    });
  }, []);
  const toggleWeapon = useCallback(() => {
    setWeapon((value) => {
      if (value) return false;
      if (exploded) setExplodedState(false);
      setPower('standby');
      return true;
    });
  }, [exploded]);
  const markSceneReady = useCallback(() => setSceneReady(true), []);

  const value = useMemo<ShipContextValue>(
    () => ({
      exploded,
      toggleExploded,
      setExploded,
      labels,
      toggleLabels,
      hovered,
      setHovered,
      selected,
      setSelected,
      power,
      togglePower,
      weapon,
      toggleWeapon,
      sceneReady,
      markSceneReady,
      reducedMotion,
    }),
    [
      exploded,
      toggleExploded,
      setExploded,
      labels,
      toggleLabels,
      hovered,
      selected,
      power,
      togglePower,
      weapon,
      toggleWeapon,
      sceneReady,
      markSceneReady,
      reducedMotion,
    ],
  );

  return <ShipContext.Provider value={value}>{children}</ShipContext.Provider>;
}

export function useShip() {
  const context = useContext(ShipContext);
  if (!context) throw new Error('useShip must be used inside ShipProvider');
  return context;
}
