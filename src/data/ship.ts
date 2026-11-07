export type PartId =
  | 'nose'
  | 'hull'
  | 'canopy'
  | 'dorsal'
  | 'core'
  | 'wingL'
  | 'wingR'
  | 'engineL'
  | 'engineR'
  | 'fin'
  | 'belly';

export type PartCategory = 'command' | 'structure' | 'propulsion' | 'weapons' | 'systems';

export interface ShipPartDef {
  id: PartId;
  index: string;
  name: string;
  nameEn: string;
  category: PartCategory;
  summary: string;
  detail: string;
  specs: { label: string; value: string }[];
  /** Translation applied in the exploded state, ship-local space. */
  offset: [number, number, number];
  /** Label anchor in assembled ship coordinates. */
  anchor: [number, number, number];
  /** Stagger 0..1; larger values move later. */
  delay: number;
  color: string;
}

export const SHIP_PARTS: ShipPartDef[] = [
  {
    id: 'nose',
    index: '01',
    name: '前向传感阵列',
    nameEn: 'FORWARD SENSOR ARRAY',
    category: 'systems',
    summary: '主动相控阵雷达、光电瞄准与导航星敏感器集成段。',
    detail:
      '任务传感器集中在可整体更换的前段模块内。陶瓷整流罩后方布置 AESA 阵列，侧向窗口提供 360° 光电告警，顶部星敏感器为深空导航提供姿态基准。',
    specs: [
      { label: '雷达体制', value: 'AESA / 2,048 单元' },
      { label: '光电窗口', value: '6 × 广角' },
      { label: '导航精度', value: '0.002°' },
    ],
    offset: [0, 0.45, 5.6],
    anchor: [4.2, 1.8, 6.8],
    delay: 0.18,
    color: '#5FE7F2',
  },
  {
    id: 'hull',
    index: '02',
    name: '主承力船体',
    nameEn: 'PRIMARY HULL',
    category: 'structure',
    summary: '钛-碳复合装甲包覆的模块化承力框架，全舰结构核心。',
    detail:
      '船体由十二道钛合金隔框与碳纤维蒙皮组成，外覆可替换陶瓷装甲板。中央承力梁贯穿全舰，前后端通过爆炸螺栓连接任务模块，可在轨道干坞内 6 小时内完成整段更换。',
    specs: [
      { label: '装甲厚度', value: '42 mm 等效' },
      { label: '隔框', value: '12 × Ti-6Al-4V' },
      { label: '设计过载', value: '12.5 G' },
    ],
    offset: [0, -0.55, 0],
    anchor: [0, 1.25, 1.1],
    delay: 0.3,
    color: '#A9BAC4',
  },
  {
    id: 'canopy',
    index: '03',
    name: '座舱系统',
    nameEn: 'COCKPIT MODULE',
    category: 'command',
    summary: '单座增压座舱，蓝宝石复合舱盖与零高度弹射系统。',
    detail:
      '一体式座舱壳体在保持气密的同时提供 310° 全向视野。舱盖由多层蓝宝石与聚碳酸酯复合，可承受微陨石撞击；座椅为可变几何抗荷型，支持零高度零速度弹射。',
    specs: [
      { label: '乘员', value: '1 名' },
      { label: '舱盖', value: '蓝宝石 / 5 层' },
      { label: '弹射包线', value: '0 m / 0 km·h⁻¹' },
    ],
    offset: [0, 3.15, 1.8],
    anchor: [-2.6, 2.0, 3.1],
    delay: 0.06,
    color: '#5FE7F2',
  },
  {
    id: 'dorsal',
    index: '04',
    name: '背脊装甲',
    nameEn: 'DORSAL SPINE',
    category: 'structure',
    summary: '可拆卸散热装甲与航电舱，覆盖核心上方维护通道。',
    detail:
      '背脊模块集成液滴散热回路、航电设备架与核心维护通道。外表面装甲板之间保留热膨胀缝，边缘布置姿态控制推进器与深空通信天线。',
    specs: [
      { label: '散热功率', value: '18 MW' },
      { label: '航电舱', value: '2.4 m³' },
      { label: '拆卸时间', value: '22 min' },
    ],
    offset: [2.15, 2.35, -1.0],
    anchor: [2.8, 1.8, 0.1],
    delay: 0.12,
    color: '#A9BAC4',
  },
  {
    id: 'core',
    index: '05',
    name: '聚变核心',
    nameEn: 'FUSION CORE Mk.IV',
    category: 'propulsion',
    summary: '氦-3 磁约束聚变反应堆，为推进与武器系统供能。',
    detail:
      'Mk.IV 核心采用双余度托卡马克约束，正常输出 38 MW，战斗峰值 74 MW。核心通过超导母线向两部 VECTOR-9 发动机与 LANCE-7 粒子炮供电，紧急情况下可在 90 秒内冷停机。',
    specs: [
      { label: '持续输出', value: '38 MW' },
      { label: '峰值输出', value: '74 MW' },
      { label: '冷停机', value: '90 s' },
    ],
    offset: [0, 1.75, 1.35],
    anchor: [-1.4, 0.9, -0.6],
    delay: 0.02,
    color: '#FF8A3D',
  },
  {
    id: 'wingL',
    index: '06',
    name: '左舷主翼',
    nameEn: 'PORT LIFTING WING',
    category: 'weapons',
    summary: '前掠升力体翼面，集成燃料舱、粒子炮与导弹挂架。',
    detail:
      '左翼为前掠升力体结构，翼根与主承力框通过四组剪切接头连接。翼内布置 1.2 吨低温燃料与冷却回路，翼尖挂架安装 LANCE-7 粒子炮，翼下保留两个多用途挂点。',
    specs: [
      { label: '前掠角', value: '14°' },
      { label: '翼面积', value: '6.8 m²' },
      { label: '内置燃料', value: '1.2 t' },
    ],
    offset: [-4.8, 1.25, -0.5],
    anchor: [-7.2, 0.8, -2.1],
    delay: 0.16,
    color: '#A9BAC4',
  },
  {
    id: 'wingR',
    index: '07',
    name: '右舷主翼',
    nameEn: 'STARBOARD LIFTING WING',
    category: 'weapons',
    summary: '与左翼镜像的前掠翼面，挂载第二门粒子炮。',
    detail:
      '右翼结构与左翼镜像，独立燃料与冷却回路保证战损冗余。翼尖 LANCE-7 粒子炮由核心直接供电，翼面后缘布置升降副翼与阻力方向舵。',
    specs: [
      { label: '前掠角', value: '14°' },
      { label: '翼面积', value: '6.8 m²' },
      { label: '挂点', value: '2 × 多用途' },
    ],
    offset: [4.8, 1.25, -0.5],
    anchor: [7.2, 0.8, -2.1],
    delay: 0.16,
    color: '#A9BAC4',
  },
  {
    id: 'engineL',
    index: '08',
    name: '左舷推进器',
    nameEn: 'PORT VECTOR-9',
    category: 'propulsion',
    summary: 'VECTOR-9 等离子冲压发动机，矢量喷口与磁约束尾焰。',
    detail:
      'VECTOR-9 采用可变循环冲压结构，在大气层内使用吸气模式，真空中切换为纯等离子推进。喷口由陶瓷基复合材料制成，可在 2 秒内完成 ±18° 双向矢量偏转。',
    specs: [
      { label: '最大推力', value: '142 kN' },
      { label: '比冲', value: '18,400 s' },
      { label: '矢量角', value: '±18°' },
    ],
    offset: [-3.5, 0.85, -3.9],
    anchor: [-4.6, 1.5, -5.2],
    delay: 0.1,
    color: '#FF8A3D',
  },
  {
    id: 'engineR',
    index: '09',
    name: '右舷推进器',
    nameEn: 'STARBOARD VECTOR-9',
    category: 'propulsion',
    summary: '右舷 VECTOR-9 发动机，独立供电与冷却冗余。',
    detail:
      '右舷推进器与左舷完全独立，拥有单独的超导母线、冷却泵与矢量作动器。单发失效时剩余推力仍可维持 0.8 推重比，并允许安全返回轨道干坞。',
    specs: [
      { label: '最大推力', value: '142 kN' },
      { label: '比冲', value: '18,400 s' },
      { label: '重启时间', value: '4.2 s' },
    ],
    offset: [3.5, 0.85, -3.9],
    anchor: [4.6, 1.5, -5.2],
    delay: 0.1,
    color: '#FF8A3D',
  },
  {
    id: 'fin',
    index: '10',
    name: '矢量尾翼',
    nameEn: 'VECTOR TAIL FIN',
    category: 'structure',
    summary: '双余度矢量控制面，负责俯仰与偏航配平。',
    detail:
      '双垂尾向外倾斜 22°，在真空与大气层内均提供稳定的偏航控制。每个控制面由两组独立作动器驱动，控制计算机可在单侧失效时自动重构控制律。',
    specs: [
      { label: '倾角', value: '22° 外倾' },
      { label: '作动器', value: '4 × 冗余' },
      { label: '偏转范围', value: '±32°' },
    ],
    offset: [0, 4.0, -3.7],
    anchor: [0, 3.15, -5.2],
    delay: 0.2,
    color: '#A9BAC4',
  },
  {
    id: 'belly',
    index: '11',
    name: '腹部任务舱',
    nameEn: 'VENTRAL MISSION POD',
    category: 'systems',
    summary: '可换装任务模块，集成对接环、起落架与辅助传感器。',
    detail:
      '腹部任务舱可按任务更换为侦察、电子战或补给模块。标准配置包含三组液压起落架、轨道对接环、近距避碰雷达与两具辅助机械臂接口。',
    specs: [
      { label: '任务模块', value: '可整体换装' },
      { label: '对接方式', value: 'ANDROGYNOUS' },
      { label: '起落架', value: '3 × 液压' },
    ],
    offset: [0, -2.9, -0.2],
    anchor: [0, -1.3, 0.8],
    delay: 0.24,
    color: '#A9BAC4',
  },
];

export const PART_MAP = Object.fromEntries(SHIP_PARTS.map((part) => [part.id, part])) as Record<
  PartId,
  ShipPartDef
>;

export const WEAPON_MUZZLES: [number, number, number][] = [
  [-5.55, 0.02, 1.35],
  [5.55, 0.02, 1.35],
];

export const ENGINE_NOZZLES: [number, number, number][] = [
  [-3.0, -0.05, -6.85],
  [3.0, -0.05, -6.85],
];

export const SHIP_SPECS = [
  { label: '全长', value: '18.4', unit: 'm' },
  { label: '翼展', value: '14.0', unit: 'm' },
  { label: '全高', value: '4.8', unit: 'm' },
  { label: '空重', value: '9.8', unit: 't' },
  { label: '最大推力', value: '284', unit: 'kN' },
  { label: '核心输出', value: '74', unit: 'MW' },
];

export const SHIP_IDENTITY = {
  name: 'HELIOS-9',
  nameCn: '日冕级深空截击舰',
  maker: 'ASTRAEUS DYNAMICS',
  yard: 'ORBITAL DRYDOCK 07',
  registry: 'AX-09 / HELIOS',
  class: 'CORONA-CLASS INTERCEPTOR',
  mission: 'LONG RANGE INTERCEPT / DEEP SPACE PATROL',
} as const;

export const PART_CATEGORY_LABELS: Record<PartCategory, string> = {
  command: '指挥控制',
  structure: '结构装甲',
  propulsion: '推进动力',
  weapons: '武器系统',
  systems: '任务系统',
};
