import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PART_CATEGORY_LABELS,
  PART_MAP,
  SHIP_IDENTITY,
  SHIP_PARTS,
  SHIP_SPECS,
  type PartCategory,
  type ShipPartDef,
} from '../data/ship';
import { useShip } from '../state/ship';
import './hud.css';

const MIN_BOOT_MS = 1400;

const BOOT_LINES = [
  { label: 'POWER BUS', state: 'NOMINAL' },
  { label: 'GYRO CALIBRATION', state: 'LOCKED' },
  { label: 'OPTICS ARRAY', state: '6 CH ONLINE' },
  { label: 'FUSION CORE', state: 'STANDBY' },
  { label: 'TELEMETRY UPLINK', state: 'SECURE' },
  { label: 'DRYDOCK CLAMPS', state: 'RELEASED' },
];

const CATEGORY_CODES: Record<PartCategory, string> = {
  command: 'CMD',
  structure: 'STR',
  propulsion: 'PRP',
  weapons: 'WPN',
  systems: 'SYS',
};

type BootPhase = 'boot' | 'leaving' | 'done';

function formatCoord(value: number) {
  const fixed = value.toFixed(2);
  return value >= 0 ? `+${fixed}` : fixed;
}

interface LoadingOverlayProps {
  sceneReady: boolean;
  reducedMotion: boolean;
  onDone: () => void;
}

function LoadingOverlay({ sceneReady, reducedMotion, onDone }: LoadingOverlayProps) {
  const [phase, setPhase] = useState<BootPhase>('boot');
  const [progress, setProgress] = useState(2);
  const [lineCount, setLineCount] = useState(1);
  const mountedAt = useRef(0);

  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  useEffect(() => {
    if (phase !== 'boot') return;
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - mountedAt.current;
      setLineCount(Math.min(BOOT_LINES.length, 1 + Math.floor(elapsed / 190)));
      setProgress((current) => {
        const timeTarget = Math.min(88, (elapsed / MIN_BOOT_MS) * 88);
        const target = sceneReady ? 100 : timeTarget;
        const next = current + (target - current) * 0.18;
        return Math.min(sceneReady ? 100 : 97.5, next);
      });
    }, 70);
    return () => window.clearInterval(timer);
  }, [phase, sceneReady]);

  useEffect(() => {
    if (!sceneReady || phase !== 'boot') return;
    const elapsed = performance.now() - mountedAt.current;
    const wait = Math.max(0, MIN_BOOT_MS - elapsed) + 320;
    const timer = window.setTimeout(() => {
      setProgress(100);
      setLineCount(BOOT_LINES.length);
      setPhase('leaving');
    }, wait);
    return () => window.clearTimeout(timer);
  }, [phase, sceneReady]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setPhase('done'), reducedMotion ? 80 : 780);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion]);

  useEffect(() => {
    if (phase === 'done') onDone();
  }, [phase, onDone]);

  if (phase === 'done') return null;

  const percent = Math.min(100, Math.round(progress));
  const status =
    phase === 'leaving'
      ? 'LINK ESTABLISHED'
      : sceneReady
        ? 'SCENE LINK READY'
        : 'ESTABLISHING SCENE LINK';
  const statusCn = phase === 'leaving' ? '链路已建立' : '正在建立场景链路';

  return (
    <div className={`hud-boot ${phase === 'leaving' ? 'is-leaving' : ''}`} aria-busy={phase !== 'leaving'}>
      <p className="hud-sr" aria-live="polite">
        HELIOS-9 {statusCn}
      </p>

      <div className="hud-boot__top" aria-hidden="true">
        <span>
          <b>ASTRAEUS DYNAMICS</b> / ORBITAL DRYDOCK 07
        </span>
        <span>{SHIP_IDENTITY.registry}</span>
        <span>BOOT SEQ / 09-11</span>
      </div>

      <span className="hud-boot__ghost" aria-hidden="true">
        09
      </span>

      <div className="hud-boot__main">
        <div className="hud-boot__brand">
          <span className="hud-boot__eyebrow">{SHIP_IDENTITY.class}</span>
          <span className="hud-boot__wordmark">
            HELIOS<span>-9</span>
          </span>
          <span className="hud-boot__cn">{SHIP_IDENTITY.nameCn}</span>
          <span className="hud-boot__maker">
            {SHIP_IDENTITY.maker} / {SHIP_IDENTITY.yard}
          </span>
        </div>

        <div className="hud-boot__telemetry" aria-hidden="true">
          <div className="hud-boot__telemetry-head">
            <span>BOOT TELEMETRY</span>
            <span>
              {String(lineCount).padStart(2, '0')} / {String(BOOT_LINES.length).padStart(2, '0')}
            </span>
          </div>
          <ul className="hud-boot__lines">
            {BOOT_LINES.slice(0, lineCount).map((line) => (
              <li className="hud-boot__line" key={line.label}>
                <span className="hud-boot__line-label">{line.label}</span>
                <span className="hud-boot__leader" />
                <span className="hud-boot__state">{line.state}</span>
              </li>
            ))}
            <li className={`hud-boot__line is-final ${sceneReady ? 'is-ready' : ''}`}>
              <span className="hud-boot__line-label">SCENE COMPOSITE</span>
              <span className="hud-boot__leader" />
              <span className="hud-boot__state">{sceneReady ? 'READY' : 'STANDBY'}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="hud-boot__footer">
        <div className="hud-boot__progress-head">
          <span className="hud-boot__status">
            <i className="hud-boot__pulse" aria-hidden="true" />
            {status}
            <em>{statusCn}</em>
          </span>
          <span className="hud-boot__pct" aria-hidden="true">
            {String(percent).padStart(2, '0')}
            <i>%</i>
          </span>
        </div>
        <div
          className="hud-boot__track"
          role="progressbar"
          aria-label="场景加载进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="hud-boot__fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="hud-boot__meta" aria-hidden="true">
          <span>SCENE LINK / 场景合成</span>
          <span>TELEMETRY UPLINK / 遥测链路</span>
          <span>STABLE ORBIT / 稳定轨道</span>
        </div>
      </div>
    </div>
  );
}

export function Hud(): JSX.Element {
  const {
    exploded,
    labels,
    hovered,
    selected,
    power,
    weapon,
    sceneReady,
    reducedMotion,
    toggleExploded,
    toggleLabels,
    setHovered,
    setSelected,
    togglePower,
    toggleWeapon,
  } = useShip();

  const [booted, setBooted] = useState(false);
  const [shownPart, setShownPart] = useState<ShipPartDef | null>(null);

  const handleBootDone = useCallback(() => setBooted(true), []);

  const hoveredPart = hovered ? PART_MAP[hovered] : null;
  const selectedPart = selected ? PART_MAP[selected] : null;
  const detailPart = hoveredPart ?? selectedPart;

  useEffect(() => {
    if (detailPart) {
      setShownPart(detailPart);
      return;
    }
    const timer = window.setTimeout(() => setShownPart(null), 240);
    return () => window.clearTimeout(timer);
  }, [detailPart]);

  const panelPart = detailPart ?? shownPart;

  const handleExplode = useCallback(() => {
    setHovered(null);
    setSelected(null);
    toggleExploded();
  }, [setHovered, setSelected, toggleExploded]);

  const handleClear = useCallback(() => {
    setHovered(null);
    setSelected(null);
  }, [setHovered, setSelected]);

  useEffect(() => {
    if (!booted) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      const onControl = Boolean(target?.closest('button, a'));

      switch (event.code) {
        case 'Space':
          if (onControl) return;
          event.preventDefault();
          if (!event.repeat) handleExplode();
          break;
        case 'KeyF':
          event.preventDefault();
          if (!event.repeat) togglePower();
          break;
        case 'KeyL':
          event.preventDefault();
          if (!event.repeat && !exploded) toggleWeapon();
          break;
        case 'KeyE':
          event.preventDefault();
          if (!event.repeat) toggleLabels();
          break;
        case 'Escape':
          event.preventDefault();
          handleClear();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [booted, exploded, handleClear, handleExplode, toggleLabels, togglePower, toggleWeapon]);

  const coreOutput = weapon ? '74.0' : power === 'ignition' ? '61.4' : '38.0';
  const coreLoad = weapon ? 100 : power === 'ignition' ? 82 : 51;
  const engineLabel = power === 'ignition' ? 'IGNITION' : 'STANDBY';
  const engineDetail = power === 'ignition' ? '284 kN' : '0 kN';
  const weaponLabel = weapon ? 'ARMED' : 'SAFE';
  const weaponDetail = exploded ? 'VIEW LOCK' : weapon ? 'LANCE-7' : 'CLEAR';
  const topStatus = exploded ? 'DIAGRAM MODE' : weapon ? 'WEAPON HOT' : power === 'ignition' ? 'IGNITION' : 'SYS NOMINAL';
  const modeLabel = exploded ? 'EXPLODED' : 'ASSEMBLED';
  const modeCn = exploded ? '解剖视图' : '总装视图';

  const liveSummary = `${exploded ? '解剖视图' : '总装视图'}。引擎${
    power === 'ignition' ? '点火' : '待机'
  }。激光${weapon ? '测试中' : '安全'}。${
    selected ? `已选中${PART_MAP[selected].name}` : '未选中部件'
  }。`;

  return (
    <div className={`hud ${booted ? 'is-booted' : ''} ${exploded ? 'is-exploded' : ''}`}>
      <LoadingOverlay sceneReady={sceneReady} reducedMotion={reducedMotion} onDone={handleBootDone} />

      <div className="hud-chrome" aria-hidden={booted ? undefined : true}>
        <p className="hud-sr" role="status" aria-live="polite">
          {liveSummary}
        </p>

        <header className="hud-id">
          <div className="hud-id__eyebrow">
            <span className="hud-id__sigil" aria-hidden="true" />
            <span>{SHIP_IDENTITY.maker}</span>
            <span className="hud-id__branch">/ DEFENSE SYSTEMS</span>
          </div>
          <h1 className="hud-id__name">
            HELIOS<span className="hud-id__nine">-9</span>
          </h1>
          <p className="hud-id__cn">{SHIP_IDENTITY.nameCn}</p>
          <p className="hud-id__meta">
            <span>{SHIP_IDENTITY.registry}</span>
            <span>{SHIP_IDENTITY.yard}</span>
          </p>
          <p className="hud-id__mission">{SHIP_IDENTITY.mission}</p>
        </header>

        <section className="hud-telemetry" aria-label="实时遥测">
          <div className="hud-telemetry__top">
            <span className="hud-status">
              <span className="hud-status__dot" aria-hidden="true" />
              {topStatus}
            </span>
            <span className="hud-telemetry__mode">
              <span>VIEW</span> <b>{modeLabel}</b> <i>{modeCn}</i>
            </span>
          </div>
          <dl className="hud-telemetry__grid">
            <div className="hud-metric">
              <dt className="hud-metric__label">
                CORE <i>核心</i>
              </dt>
              <dd className="hud-metric__readout">
                <span className="hud-metric__value">{coreOutput}</span>
                <span className="hud-metric__unit">MW</span>
              </dd>
              <div className="hud-metric__bar" aria-hidden="true">
                <span style={{ width: `${coreLoad}%` }} />
              </div>
            </div>
            <div className="hud-metric">
              <dt className="hud-metric__label">
                HULL <i>结构</i>
              </dt>
              <dd className="hud-metric__readout">
                <span className="hud-metric__value">100.0</span>
                <span className="hud-metric__unit">%</span>
              </dd>
              <div className="hud-metric__bar" aria-hidden="true">
                <span style={{ width: '100%' }} />
              </div>
            </div>
            <div className={`hud-metric ${power === 'ignition' ? 'is-live' : ''}`}>
              <dt className="hud-metric__label">
                ENGINE <i>推进</i>
              </dt>
              <dd className="hud-metric__readout is-text">
                <span className="hud-metric__value">{engineLabel}</span>
              </dd>
              <div className="hud-metric__sub">{engineDetail}</div>
            </div>
            <div className={`hud-metric ${weapon ? 'is-live' : ''}`}>
              <dt className="hud-metric__label">
                WEAPON <i>武器</i>
              </dt>
              <dd className="hud-metric__readout is-text">
                <span className="hud-metric__value">{weaponLabel}</span>
              </dd>
              <div className="hud-metric__sub">{weaponDetail}</div>
            </div>
          </dl>
        </section>

        <div className="hud-edge hud-edge--left" aria-hidden="true">
          <span>{SHIP_IDENTITY.mission}</span>
        </div>
        <div className="hud-edge hud-edge--right" aria-hidden="true">
          <span>
            {SHIP_IDENTITY.yard} / FRAME 09
          </span>
        </div>

        {exploded && (
          <nav className="hud-parts" aria-label="模块索引">
            <div className="hud-parts__head">
              <span className="hud-parts__title">MODULE INDEX</span>
              <span className="hud-parts__count">11</span>
            </div>
            <div className="hud-parts__sub">DECOMPOSED ASSEMBLY / 剖析总成</div>
            <ul className="hud-parts__list">
              {SHIP_PARTS.map((part) => {
                const active = hovered === part.id || selected === part.id;
                const isSelected = selected === part.id;
                return (
                  <li
                    key={part.id}
                    onClick={(event) => {
                      // QA and touch paths can hit the row itself; the inner button
                      // still owns keyboard activation and its own click.
                      if (event.target !== event.currentTarget) return;
                      setSelected(isSelected ? null : part.id);
                    }}
                  >
                    <button
                      type="button"
                      className={`hud-part ${active ? 'is-active' : ''} ${
                        isSelected ? 'is-selected' : ''
                      }`}
                      aria-pressed={isSelected}
                      aria-label={`${part.index} ${part.name} ${part.nameEn}`}
                      onPointerEnter={() => setHovered(part.id)}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => setHovered(part.id)}
                      onBlur={() => setHovered(null)}
                      onClick={() => setSelected(isSelected ? null : part.id)}
                    >
                      <span className="hud-part__index">{part.index}</span>
                      <span className="hud-part__name">{part.name}</span>
                      <span className="hud-part__cat">{CATEGORY_CODES[part.category]}</span>
                      <span className="hud-part__tick" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="hud-parts__foot">
              <span>01-11 / SELECT</span>
              <span>CLICK TO INSPECT</span>
            </div>
          </nav>
        )}

        <aside
          className={`hud-detail ${detailPart ? 'is-visible' : ''}`}
          aria-label="部件详情"
          aria-hidden={detailPart ? undefined : true}
        >
          {panelPart && (
            <div className="hud-detail__inner" key={panelPart.id}>
              <div className="hud-detail__head">
                <span className="hud-detail__index">{panelPart.index}</span>
                <span className="hud-detail__cat">
                  {PART_CATEGORY_LABELS[panelPart.category]}
                  <i>{panelPart.category.toUpperCase()}</i>
                </span>
                <span className="hud-detail__source">
                  {hovered === panelPart.id ? 'HOVER' : 'SELECTED'}
                </span>
              </div>
              <h2 className="hud-detail__name">{panelPart.name}</h2>
              <p className="hud-detail__en">{panelPart.nameEn}</p>
              <p className="hud-detail__summary">{panelPart.summary}</p>
              <dl className="hud-detail__specs">
                {panelPart.specs.map((spec) => (
                  <div key={spec.label}>
                    <dt>{spec.label}</dt>
                    <dd>{spec.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="hud-detail__foot">
                <span>ANCHOR / 锚点</span>
                <span>
                  X {formatCoord(panelPart.anchor[0])} / Y {formatCoord(panelPart.anchor[1])} / Z{' '}
                  {formatCoord(panelPart.anchor[2])}
                </span>
              </div>
            </div>
          )}
        </aside>

        <div className="hud-bottom">
          <section
            className={`hud-specs ${exploded ? 'is-hidden' : ''}`}
            aria-label="舰船规格"
            aria-hidden={exploded}
          >
            <div className="hud-specs__lead">
              <span>SHIP SPEC</span>
              <i>舰船规格</i>
            </div>
            <dl className="hud-specs__list">
              {SHIP_SPECS.map((spec) => (
                <div className="hud-spec" key={spec.label}>
                  <dt>{spec.label}</dt>
                  <dd>
                    <b>{spec.value}</b>
                    <span>{spec.unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="hud-hint">
            <span className="hud-hint__mark" aria-hidden="true" />
            <span>拖拽旋转</span>
            <span className="hud-hint__sep" aria-hidden="true">
              /
            </span>
            <span className="hud-hint__desktop">滚轮缩放</span>
            <span className="hud-hint__mobile">双指缩放</span>
            <span className="hud-hint__sep" aria-hidden="true">
              /
            </span>
            <span>点击部件查看</span>
          </div>

          <nav className="hud-dock" aria-label="舰船控制">
            <button
              type="button"
              className="hud-btn hud-btn--primary"
              aria-pressed={exploded}
              aria-keyshortcuts="Space"
              aria-label={
                exploded
                  ? '复位飞船，退出解剖视图，快捷键 空格'
                  : '解剖飞船，展开全部 11 个模块，快捷键 空格'
              }
              onClick={handleExplode}
            >
              <span className="hud-btn__mark" aria-hidden="true" />
              <span className="hud-btn__copy">
                <span className="hud-btn__label">{exploded ? '复位总装' : '解剖飞船'}</span>
                <span className="hud-btn__en">{exploded ? 'ASSEMBLE' : 'EXPLODE VIEW'}</span>
              </span>
              <kbd className="hud-kbd">SPACE</kbd>
            </button>

            <span className="hud-dock__divider" aria-hidden="true" />

            <div className="hud-dock__controls">
              <button
                type="button"
                className="hud-btn hud-btn--toggle"
                aria-pressed={power === 'ignition'}
                aria-keyshortcuts="F"
                aria-label={`引擎点火，当前${power === 'ignition' ? '已点火' : '待机'}，快捷键 F`}
                onClick={togglePower}
              >
                <span className="hud-toggle__dot" aria-hidden="true" />
                <span className="hud-toggle__label">引擎点火</span>
                <kbd className="hud-kbd">F</kbd>
              </button>

              <button
                type="button"
                className="hud-btn hud-btn--toggle"
                aria-pressed={weapon}
                aria-disabled={exploded}
                aria-keyshortcuts="L"
                disabled={exploded}
                title={exploded ? '解剖视图下激光测试不可用' : '快捷键 L'}
                aria-label={
                  exploded
                    ? '激光测试，解剖视图下不可用'
                    : `激光测试，当前${weapon ? '测试中' : '安全'}，快捷键 L`
                }
                onClick={() => {
                  if (!exploded) toggleWeapon();
                }}
              >
                <span className="hud-toggle__dot" aria-hidden="true" />
                <span className="hud-toggle__label">激光测试</span>
                <kbd className="hud-kbd">L</kbd>
              </button>

              <button
                type="button"
                className="hud-btn hud-btn--toggle"
                aria-pressed={labels}
                aria-keyshortcuts="E"
                aria-label={`部件标签，当前${labels ? '显示' : '隐藏'}，快捷键 E`}
                onClick={toggleLabels}
              >
                <span className="hud-toggle__dot" aria-hidden="true" />
                <span className="hud-toggle__label">部件标签</span>
                <kbd className="hud-kbd">E</kbd>
              </button>

              <button
                type="button"
                className="hud-btn hud-btn--toggle"
                aria-disabled={!selected}
                aria-keyshortcuts="Escape"
                disabled={!selected}
                title={selected ? '快捷键 Esc' : '尚未选中部件'}
                aria-label="清除已选部件，快捷键 Esc"
                onClick={handleClear}
              >
                <span className="hud-toggle__dot" aria-hidden="true" />
                <span className="hud-toggle__label">清除选择</span>
                <kbd className="hud-kbd">ESC</kbd>
              </button>
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}
