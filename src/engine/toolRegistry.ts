import { MaterialId } from './voxelPlanet';

export type ToolGroup =
  | 'inspect'
  | 'pierce'
  | 'cataclysm'
  | 'sculpt'
  | 'paint'
  | 'custom';

export type ToolBehavior =
  | 'probe'
  | 'seismicProbe'
  | 'surveyPin'
  | 'surveyTransect'
  | 'surveyBorehole'
  | 'surveyClinometer'
  | 'carve'
  | 'pierce'
  | 'continuousLaser'
  | 'megaLaser'
  | 'bore'
  | 'explosion'
  | 'nuke'
  | 'burn'
  | 'magma'
  | 'lightning'
  | 'meteor'
  | 'worm'
  | 'orbitalStrike'
  | 'blackHole'
  | 'tornado'
  | 'build'
  | 'extrude'
  | 'tractorBeam'
  | 'volcano'
  | 'crystalGrow'
  | 'quake'
  | 'smooth'
  | 'flatten'
  | 'terraform'
  | 'paint'
  | 'freezeBeam'
  | 'water'
  | 'geyser'
  | 'drain';

export type ToolIconName =
  | 'pipette'
  | 'radar'
  | 'pickaxe'
  | 'crosshair'
  | 'zap'
  | 'radio'
  | 'sun'
  | 'scissors'
  | 'bomb'
  | 'radiation'
  | 'flame'
  | 'flame-kindling'
  | 'cloud-lightning'
  | 'orbit'
  | 'bug'
  | 'rocket'
  | 'disc3'
  | 'wind'
  | 'boxes'
  | 'arrow-up-from-line'
  | 'mountain'
  | 'gem'
  | 'activity'
  | 'waves'
  | 'minus'
  | 'trees'
  | 'paintbrush'
  | 'snowflake'
  | 'droplets'
  | 'sparkles'
  | 'eraser'
  | 'magnet'
  | 'map-pin'
  | 'ruler'
  | 'layers'
  | 'compass'
  | 'wand';

export interface ToolAttributes {
  behavior: ToolBehavior;
  radiusMult: number;
  strengthMult: number;
  cooldownSec: number;
  pierceDepthRatio: number; // Relative to planet baseRadius R0
  debrisCount: number;
  thermalDeltaC: number;
  entitySpeed: number;
  entityCount: number;
  depositMaterial: 'active' | MaterialId;
  rimMaterial: 'none' | 'active' | MaterialId;
  leaveRim: boolean;
  continuousBeam: boolean;
  colorHex: string;
}

export interface PlanetToolDef {
  id: string;
  name: string;
  desc: string;
  group: ToolGroup;
  iconName: ToolIconName;
  keyHint?: string;
  isCustom?: boolean;
  attributes: ToolAttributes;
}

export interface BehaviorPresetMeta {
  behavior: ToolBehavior;
  label: string;
  desc: string;
  defaultIcon: ToolIconName;
  defaultColor: string;
  defaults: Omit<ToolAttributes, 'behavior' | 'colorHex'>;
}

export const TOOL_BEHAVIOR_PRESETS: ReadonlyArray<BehaviorPresetMeta> = [
  {
    behavior: 'carve',
    label: '球形挖矿',
    desc: '常规球体切削体素岩层',
    defaultIcon: 'pickaxe',
    defaultColor: '#f97316',
    defaults: {
      radiusMult: 1.0,
      strengthMult: 1.0,
      cooldownSec: 0.07,
      pierceDepthRatio: 0,
      debrisCount: 6,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'pierce',
    label: '贯穿钻孔/激光',
    desc: '沿视线一击贯穿至星球另一侧',
    defaultIcon: 'crosshair',
    defaultColor: '#f59e0b',
    defaults: {
      radiusMult: 1.0,
      strengthMult: 1.45,
      cooldownSec: 0.08,
      pierceDepthRatio: 2.7,
      debrisCount: 8,
      thermalDeltaC: 180,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: MaterialId.Basalt,
      leaveRim: false,
      continuousBeam: true,
    },
  },
  {
    behavior: 'continuousLaser',
    label: '连续激光扫射',
    desc: '高频持续灼烧光束，随鼠标移动平滑切开深沟',
    defaultIcon: 'radio',
    defaultColor: '#fb7185',
    defaults: {
      radiusMult: 0.72,
      strengthMult: 1.85,
      cooldownSec: 0.025,
      pierceDepthRatio: 2.7,
      debrisCount: 5,
      thermalDeltaC: 420,
      entitySpeed: 1.4,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: MaterialId.Basalt,
      leaveRim: false,
      continuousBeam: true,
    },
  },
  {
    behavior: 'megaLaser',
    label: '超大灭星激光',
    desc: '超粗强光束直穿星核并熔蚀巨大对穿峡谷',
    defaultIcon: 'sun',
    defaultColor: '#ff2e63',
    defaults: {
      radiusMult: 2.8,
      strengthMult: 3.4,
      cooldownSec: 0.06,
      pierceDepthRatio: 3.0,
      debrisCount: 22,
      thermalDeltaC: 1200,
      entitySpeed: 1.8,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: MaterialId.Basalt,
      leaveRim: true,
      continuousBeam: true,
    },
  },
  {
    behavior: 'explosion',
    label: '高爆冲击',
    desc: '瞬时炸出环形弹坑、冲击波与飞散碎石',
    defaultIcon: 'bomb',
    defaultColor: '#f97316',
    defaults: {
      radiusMult: 1.85,
      strengthMult: 2.6,
      cooldownSec: 0.24,
      pierceDepthRatio: 0,
      debrisCount: 26,
      thermalDeltaC: 360,
      entitySpeed: 1.3,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: MaterialId.Basalt,
      leaveRim: true,
      continuousBeam: false,
    },
  },
  {
    behavior: 'nuke',
    label: '热核爆裂',
    desc: '超大规模核爆陨坑、玻璃化基底、蘑菇火球与高温热点',
    defaultIcon: 'radiation',
    defaultColor: '#eab308',
    defaults: {
      radiusMult: 3.2,
      strengthMult: 4.5,
      cooldownSec: 0.45,
      pierceDepthRatio: 0,
      debrisCount: 48,
      thermalDeltaC: 1850,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: MaterialId.Crystal,
      rimMaterial: MaterialId.Basalt,
      leaveRim: true,
      continuousBeam: false,
    },
  },
  {
    behavior: 'burn',
    label: '炽热燃烧',
    desc: '焦化地表岩土与极冰，生成灼烧余烬与剧烈升温',
    defaultIcon: 'flame',
    defaultColor: '#ef4444',
    defaults: {
      radiusMult: 1.35,
      strengthMult: 1.25,
      cooldownSec: 0.075,
      pierceDepthRatio: 0,
      debrisCount: 8,
      thermalDeltaC: 680,
      entitySpeed: 1.2,
      entityCount: 3,
      depositMaterial: MaterialId.Basalt,
      rimMaterial: MaterialId.Sandstone,
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'magma',
    label: '岩浆喷涌',
    desc: '融穿熔池并喷出沿重力流动、冷却后凝结为玄武岩的熔岩球',
    defaultIcon: 'flame-kindling',
    defaultColor: '#ff5500',
    defaults: {
      radiusMult: 1.2,
      strengthMult: 1.4,
      cooldownSec: 0.11,
      pierceDepthRatio: 0,
      debrisCount: 6,
      thermalDeltaC: 1100,
      entitySpeed: 1.1,
      entityCount: 4,
      depositMaterial: MaterialId.Basalt,
      rimMaterial: MaterialId.Basalt,
      leaveRim: true,
      continuousBeam: false,
    },
  },
  {
    behavior: 'lightning',
    label: '天罚闪电',
    desc: '高空分叉电弧劈击地表，形成晶化闪电熔岩坑',
    defaultIcon: 'cloud-lightning',
    defaultColor: '#60a5fa',
    defaults: {
      radiusMult: 1.25,
      strengthMult: 2.1,
      cooldownSec: 0.18,
      pierceDepthRatio: 0,
      debrisCount: 16,
      thermalDeltaC: 920,
      entitySpeed: 1.5,
      entityCount: 3,
      depositMaterial: MaterialId.Crystal,
      rimMaterial: MaterialId.Crystal,
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'meteor',
    label: '陨石天降',
    desc: '从轨道发射燃烧小行星高速俯冲撞击并砸出深坑',
    defaultIcon: 'orbit',
    defaultColor: '#fb923c',
    defaults: {
      radiusMult: 2.1,
      strengthMult: 3.1,
      cooldownSec: 0.28,
      pierceDepthRatio: 0,
      debrisCount: 32,
      thermalDeltaC: 760,
      entitySpeed: 1.35,
      entityCount: 1,
      depositMaterial: MaterialId.Basalt,
      rimMaterial: MaterialId.Sandstone,
      leaveRim: true,
      continuousBeam: false,
    },
  },
  {
    behavior: 'worm',
    label: '体素蠕虫',
    desc: '投放多节活体钻地蠕虫，自主蜿蜒啃穿地壳与星核',
    defaultIcon: 'bug',
    defaultColor: '#84cc16',
    defaults: {
      radiusMult: 0.85,
      strengthMult: 1.8,
      cooldownSec: 0.35,
      pierceDepthRatio: 0,
      debrisCount: 4,
      thermalDeltaC: 40,
      entitySpeed: 1.1,
      entityCount: 8,
      depositMaterial: MaterialId.Crystal,
      rimMaterial: MaterialId.Soil,
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'orbitalStrike',
    label: '天基动能弹',
    desc: '连续齐射多发穿甲动能柱垂直轰击目标区',
    defaultIcon: 'rocket',
    defaultColor: '#a855f7',
    defaults: {
      radiusMult: 1.15,
      strengthMult: 2.8,
      cooldownSec: 0.24,
      pierceDepthRatio: 0.75,
      debrisCount: 24,
      thermalDeltaC: 540,
      entitySpeed: 2.2,
      entityCount: 3,
      depositMaterial: MaterialId.Basalt,
      rimMaterial: MaterialId.Basalt,
      leaveRim: true,
      continuousBeam: false,
    },
  },
  {
    behavior: 'blackHole',
    label: '微型奇点',
    desc: '产生引力坍缩黑洞，吞噬周边水流并将岩石压实为晶矿',
    defaultIcon: 'disc3',
    defaultColor: '#818cf8',
    defaults: {
      radiusMult: 1.75,
      strengthMult: 2.0,
      cooldownSec: 0.45,
      pierceDepthRatio: 0,
      debrisCount: 10,
      thermalDeltaC: -120,
      entitySpeed: 1.2,
      entityCount: 1,
      depositMaterial: MaterialId.Crystal,
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'tornado',
    label: '气旋龙卷',
    desc: '沿地表游走的气旋漏斗，卷起水柱并侵蚀松散表土',
    defaultIcon: 'wind',
    defaultColor: '#2dd4bf',
    defaults: {
      radiusMult: 1.6,
      strengthMult: 1.1,
      cooldownSec: 0.4,
      pierceDepthRatio: 0,
      debrisCount: 10,
      thermalDeltaC: -18,
      entitySpeed: 1.1,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'bore',
    label: '剖面切割',
    desc: '切开深层地壳以观察行星地幔与矿脉剖面',
    defaultIcon: 'scissors',
    defaultColor: '#e879f9',
    defaults: {
      radiusMult: 1.1,
      strengthMult: 1.3,
      cooldownSec: 0.08,
      pierceDepthRatio: 0.65,
      debrisCount: 6,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'build',
    label: '体素堆叠',
    desc: '增材堆砌选定矿物球体',
    defaultIcon: 'boxes',
    defaultColor: '#10b981',
    defaults: {
      radiusMult: 1.0,
      strengthMult: 1.0,
      cooldownSec: 0.075,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'extrude',
    label: '立柱拉伸',
    desc: '沿法线方向生长柱状悬崖与高塔',
    defaultIcon: 'arrow-up-from-line',
    defaultColor: '#22c55e',
    defaults: {
      radiusMult: 1.0,
      strengthMult: 1.15,
      cooldownSec: 0.08,
      pierceDepthRatio: 0.25,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'tractorBeam',
    label: '牵引光束',
    desc: '按住鼠标拖拽实时物理拉伸与移动SPH流体、碎石、岩浆与动态物体，结合牛顿引力场计算张力与下坠反馈',
    defaultIcon: 'magnet',
    defaultColor: '#22d3ee',
    defaults: {
      radiusMult: 1.5,
      strengthMult: 1.65,
      cooldownSec: 0.02,
      pierceDepthRatio: 0,
      debrisCount: 6,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: true,
    },
  },
  {
    behavior: 'volcano',
    label: '活火山造山',
    desc: '迅速隆起带火口杯的玄武岩火山锥并喷出岩浆',
    defaultIcon: 'mountain',
    defaultColor: '#ea580c',
    defaults: {
      radiusMult: 2.1,
      strengthMult: 2.0,
      cooldownSec: 0.25,
      pierceDepthRatio: 0,
      debrisCount: 14,
      thermalDeltaC: 950,
      entitySpeed: 1.2,
      entityCount: 4,
      depositMaterial: MaterialId.Basalt,
      rimMaterial: MaterialId.Basalt,
      leaveRim: true,
      continuousBeam: false,
    },
  },
  {
    behavior: 'crystalGrow',
    label: '晶簇生长',
    desc: '沿地表裂隙绽放多向晶矿棱柱尖刺',
    defaultIcon: 'gem',
    defaultColor: '#06b6d4',
    defaults: {
      radiusMult: 0.9,
      strengthMult: 1.6,
      cooldownSec: 0.14,
      pierceDepthRatio: 0.35,
      debrisCount: 4,
      thermalDeltaC: 25,
      entitySpeed: 1.0,
      entityCount: 4,
      depositMaterial: MaterialId.Crystal,
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'quake',
    label: '地震断层',
    desc: '撕裂锯齿状地壳裂谷并抬升错动山脊',
    defaultIcon: 'activity',
    defaultColor: '#ca8a04',
    defaults: {
      radiusMult: 1.8,
      strengthMult: 2.2,
      cooldownSec: 0.18,
      pierceDepthRatio: 0.45,
      debrisCount: 18,
      thermalDeltaC: 60,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: MaterialId.Stone,
      rimMaterial: MaterialId.Basalt,
      leaveRim: true,
      continuousBeam: false,
    },
  },
  {
    behavior: 'smooth',
    label: '侵蚀平滑',
    desc: '风化柔化棱角并过渡地形高差',
    defaultIcon: 'waves',
    defaultColor: '#a78bfa',
    defaults: {
      radiusMult: 1.1,
      strengthMult: 1.0,
      cooldownSec: 0.075,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'flatten',
    label: '球面整平',
    desc: '按首次落点海拔修筑等高台地',
    defaultIcon: 'minus',
    defaultColor: '#facc15',
    defaults: {
      radiusMult: 1.2,
      strengthMult: 1.0,
      cooldownSec: 0.075,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'terraform',
    label: '生态绿化',
    desc: '抚平荒漠岩石、覆盖沃土并播撒绿洲水雾',
    defaultIcon: 'trees',
    defaultColor: '#4ade80',
    defaults: {
      radiusMult: 1.45,
      strengthMult: 1.1,
      cooldownSec: 0.1,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: -8,
      entitySpeed: 1.0,
      entityCount: 6,
      depositMaterial: MaterialId.Soil,
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'paint',
    label: '材质喷涂',
    desc: '无损切换岩石矿层色彩材质，保留既有几何',
    defaultIcon: 'paintbrush',
    defaultColor: '#ec4899',
    defaults: {
      radiusMult: 1.15,
      strengthMult: 1.0,
      cooldownSec: 0.06,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'freezeBeam',
    label: '极寒射线',
    desc: '急冻冰封地表岩石为极冰并触发剧烈降温',
    defaultIcon: 'snowflake',
    defaultColor: '#bae6fd',
    defaults: {
      radiusMult: 1.35,
      strengthMult: 1.25,
      cooldownSec: 0.06,
      pierceDepthRatio: 0,
      debrisCount: 2,
      thermalDeltaC: -280,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: MaterialId.Ice,
      rimMaterial: MaterialId.Ice,
      leaveRim: false,
      continuousBeam: true,
    },
  },
  {
    behavior: 'water',
    label: '流体注水',
    desc: '向低洼盆地或穿透隧道持续注入模拟海水',
    defaultIcon: 'droplets',
    defaultColor: '#0ea5e9',
    defaults: {
      radiusMult: 1.0,
      strengthMult: 1.0,
      cooldownSec: 0.075,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: -4,
      entitySpeed: 1.0,
      entityCount: 18,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'geyser',
    label: '地热喷泉',
    desc: '高压喷涌热泉水柱直冲高空大气',
    defaultIcon: 'sparkles',
    defaultColor: '#38bdf8',
    defaults: {
      radiusMult: 0.9,
      strengthMult: 2.2,
      cooldownSec: 0.08,
      pierceDepthRatio: 0,
      debrisCount: 2,
      thermalDeltaC: 95,
      entitySpeed: 2.4,
      entityCount: 26,
      depositMaterial: MaterialId.Basalt,
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'drain',
    label: '局部抽水',
    desc: '精准抽干笔刷覆盖范围的流体水粒子',
    defaultIcon: 'eraser',
    defaultColor: '#94a3b8',
    defaults: {
      radiusMult: 1.45,
      strengthMult: 1.0,
      cooldownSec: 0.075,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'probe',
    label: '吸管探针',
    desc: '吸取地表体素矿物并探查三维坐标与温度',
    defaultIcon: 'pipette',
    defaultColor: '#38bdf8',
    defaults: {
      radiusMult: 1.0,
      strengthMult: 1.0,
      cooldownSec: 0.075,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'seismicProbe',
    label: '震波雷达',
    desc: '发射震波脉冲，激发环形探测波并拾取深层矿脉信息',
    defaultIcon: 'radar',
    defaultColor: '#22d3ee',
    defaults: {
      radiusMult: 1.8,
      strengthMult: 1.0,
      cooldownSec: 0.2,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.4,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'surveyPin',
    label: '测量控制点',
    desc: '在行星表面布设编号水准控制点，记录全坐标系坐标、高程与岩性',
    defaultIcon: 'map-pin',
    defaultColor: '#38bdf8',
    defaults: {
      radiusMult: 0.85,
      strengthMult: 1.0,
      cooldownSec: 0.25,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'surveyTransect',
    label: '测地剖面仪',
    desc: '点选A/B两点沿大圆测地线采样高程地形、地层岩性与温度剖面',
    defaultIcon: 'ruler',
    defaultColor: '#2dd4bf',
    defaults: {
      radiusMult: 0.85,
      strengthMult: 1.0,
      cooldownSec: 0.25,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'surveyBorehole',
    label: '地质钻孔取芯',
    desc: '沿径向垂直下钻采样地下地层序列，绘制柱状岩芯与地温梯度曲线',
    defaultIcon: 'layers',
    defaultColor: '#a78bfa',
    defaults: {
      radiusMult: 0.85,
      strengthMult: 1.0,
      cooldownSec: 0.3,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
  {
    behavior: 'surveyClinometer',
    label: '地质罗盘仪',
    desc: '测定岩层面走向(Strike)、倾向(Dip Dir)与倾角(Dip°)，支持区域面积圈定',
    defaultIcon: 'compass',
    defaultColor: '#fbbf24',
    defaults: {
      radiusMult: 0.9,
      strengthMult: 1.0,
      cooldownSec: 0.25,
      pierceDepthRatio: 0,
      debrisCount: 0,
      thermalDeltaC: 0,
      entitySpeed: 1.0,
      entityCount: 1,
      depositMaterial: 'active',
      rimMaterial: 'none',
      leaveRim: false,
      continuousBeam: false,
    },
  },
];

function makeBuiltin(
  id: string,
  name: string,
  desc: string,
  group: ToolGroup,
  behavior: ToolBehavior,
  keyHint?: string,
  iconName?: ToolIconName,
  colorHex?: string,
  attrOverrides?: Partial<ToolAttributes>,
): PlanetToolDef {
  const preset =
    TOOL_BEHAVIOR_PRESETS.find((p) => p.behavior === behavior) ??
    TOOL_BEHAVIOR_PRESETS[0];
  return {
    id,
    name,
    desc,
    group,
    iconName: iconName ?? preset.defaultIcon,
    keyHint,
    attributes: {
      behavior,
      ...preset.defaults,
      colorHex: colorHex ?? preset.defaultColor,
      ...attrOverrides,
    },
  };
}

export const BUILTIN_TOOLS: ReadonlyArray<PlanetToolDef> = [
  // Inspect & Geological Survey
  makeBuiltin('probe', '吸管探针', '吸取点击处矿物材质并探查体素格数据', 'inspect', 'probe', 'I', 'pipette', '#38bdf8'),
  makeBuiltin('seismicProbe', '震波雷达', '向星核发射纵波雷达脉冲探测矿脉与震荡圈', 'inspect', 'seismicProbe', undefined, 'radar', '#22d3ee'),
  makeBuiltin('surveyPin', '测量控制点', '在地表布设水准控制点并记录多坐标系坐标、高程与岩性', 'inspect', 'surveyPin', undefined, 'map-pin', '#38bdf8'),
  makeBuiltin('surveyTransect', '测地剖面线', '先后点击A/B两点测定大圆弧长与高程-岩性-温度剖面', 'inspect', 'surveyTransect', undefined, 'ruler', '#2dd4bf'),
  makeBuiltin('surveyBorehole', '钻孔岩芯仪', '沿径向垂直钻探采样地下地层岩性序列与地温梯度', 'inspect', 'surveyBorehole', undefined, 'layers', '#a78bfa'),
  makeBuiltin('surveyClinometer', '地质产状仪', '测定岩层走向/倾向/倾角与局部坡度，同步纳入区域测算', 'inspect', 'surveyClinometer', undefined, 'compass', '#fbbf24'),

  // Pierce & Lasers
  makeBuiltin('carve', '挖矿雕刻', '球形切削岩石、雕刻峡谷与地下洞窟', 'pierce', 'carve', '1', 'pickaxe', '#f97316'),
  makeBuiltin('tunnel', '穿透钻孔', '沿视线一击钻穿整颗星球与地核直达对跖面', 'pierce', 'pierce', '2', 'crosshair', '#f59e0b', {
    continuousBeam: false,
    rimMaterial: 'none',
    thermalDeltaC: 0,
  }),
  makeBuiltin('laser', '轨道激光', '发射聚能激光束直穿星核并焦化孔壁', 'pierce', 'pierce', '3', 'zap', '#f43f5e'),
  makeBuiltin('continuousLaser', '连续激光', '按住高频连射等离子扫射激光，平滑切穿地壳', 'pierce', 'continuousLaser', '4', 'radio', '#fb7185'),
  makeBuiltin('megaLaser', '灭星大激光', '超粗毁灭级轨道巨炮，贯穿星核轰出熔岩巨谷', 'pierce', 'megaLaser', '5', 'sun', '#ff2e63'),
  makeBuiltin('bore', '剖面切割', '深度剖切星球外壳与地幔以观测内部结构', 'pierce', 'bore', undefined, 'scissors', '#e879f9'),

  // Cataclysm & Fun Physics Entities
  makeBuiltin('explosion', '高爆炸药', '瞬间引爆冲击波与弹坑，击飞岩石碎片与水浪', 'cataclysm', 'explosion', '6', 'bomb', '#f97316'),
  makeBuiltin('nuke', '热核弹头', '释放蘑菇云与双环冲击波，轰出玻璃化巨型核坑', 'cataclysm', 'nuke', '7', 'radiation', '#eab308'),
  makeBuiltin('burn', '炽热燃烧', '点燃并焦化地表土石冰层，产生高温热斑与灰烬', 'cataclysm', 'burn', '8', 'flame', '#ef4444'),
  makeBuiltin('magma', '岩浆喷涌', '熔蚀坑洞并喷出滚烫熔岩球，冷却后凝固为玄武岩', 'cataclysm', 'magma', '9', 'flame-kindling', '#ff5500'),
  makeBuiltin('lightning', '天罚闪电', '召唤高空分叉蓝白闪电劈碎岩石并熔铸晶矿', 'cataclysm', 'lightning', undefined, 'cloud-lightning', '#60a5fa'),
  makeBuiltin('meteor', '陨石轰击', '从深空发射燃烧陨星高速俯冲砸穿地壳', 'cataclysm', 'meteor', undefined, 'orbit', '#fb923c'),
  makeBuiltin('worm', '体素蠕虫', '释放多节活体钻地蠕虫在星球内部蜿蜒穿行啃噬', 'cataclysm', 'worm', undefined, 'bug', '#84cc16'),
  makeBuiltin('orbitalStrike', '天基动能弹', '齐射三发超高速轨道穿甲钨棒垂直轰击区域', 'cataclysm', 'orbitalStrike', undefined, 'rocket', '#a855f7'),
  makeBuiltin('blackHole', '微型黑洞', '形成局部奇点吸引水流并将其坍缩压实为晶矿', 'cataclysm', 'blackHole', undefined, 'disc3', '#818cf8'),
  makeBuiltin('tornado', '气旋龙卷', '召唤席卷表土与水浪的旋转大气龙卷漏斗', 'cataclysm', 'tornado', undefined, 'wind', '#2dd4bf'),

  // Sculpt & Tectonic
  makeBuiltin('tractorBeam', '牵引光束', '点击并拖拽实时物理拉伸与牵引SPH流体与地表动态物体，融合牛顿引力场力学反馈', 'sculpt', 'tractorBeam', 'Y', 'magnet', '#22d3ee'),
  makeBuiltin('build', '体素堆叠', '使用选定矿物增材球形堆砌山丘与浮岛', 'sculpt', 'build', undefined, 'boxes', '#10b981'),
  makeBuiltin('extrude', '立柱拉伸', '沿表面法线向上拉伸立柱、石笋与高塔', 'sculpt', 'extrude', undefined, 'arrow-up-from-line', '#22c55e'),
  makeBuiltin('volcano', '活火山造山', '快速堆叠带炽热火山口的玄武岩活火山', 'sculpt', 'volcano', undefined, 'mountain', '#ea580c'),
  makeBuiltin('crystalGrow', '晶簇生长', '从岩壁迸发放射状闪烁晶矿尖刺群落', 'sculpt', 'crystalGrow', undefined, 'gem', '#06b6d4'),
  makeBuiltin('quake', '地震断层', '沿撞击方向撕裂大裂谷与错断山脊', 'sculpt', 'quake', undefined, 'activity', '#ca8a04'),
  makeBuiltin('smooth', '侵蚀平滑', '柔和打磨体素锯齿与陡峭山坡', 'sculpt', 'smooth', undefined, 'waves', '#a78bfa'),
  makeBuiltin('flatten', '球面整平', '以首击高度修筑环绕星球的平整台地', 'sculpt', 'flatten', undefined, 'minus', '#facc15'),
  makeBuiltin('terraform', '生态绿化', '将贫瘠岩层转化为沃土并洒下绿洲露水', 'sculpt', 'terraform', undefined, 'trees', '#4ade80'),

  // Paint & Fluid / Cryo
  makeBuiltin('paint', '材质喷涂', '纯改写矿物岩性着色而不破坏地形形状', 'paint', 'paint', undefined, 'paintbrush', '#ec4899'),
  makeBuiltin('freezeBeam', '极寒射线', '将山川海洋瞬间冻结为极冰并大幅降低温度', 'paint', 'freezeBeam', undefined, 'snowflake', '#bae6fd'),
  makeBuiltin('water', '流体注水', '向陨坑与隧道倾泻实时物理模拟液态水', 'paint', 'water', '0', 'droplets', '#0ea5e9'),
  makeBuiltin('geyser', '地热喷泉', '喷出高速直冲天际的炽热喷泉水柱', 'paint', 'geyser', undefined, 'sparkles', '#38bdf8'),
  makeBuiltin('drain', '局部抽水', '精准吸干光标范围内的液态水粒子', 'paint', 'drain', 'X', 'eraser', '#94a3b8'),
];

const CUSTOM_TOOLS_STORAGE_KEY = 'terrasphere_custom_tools_v1';
const TOOL_OVERRIDES_STORAGE_KEY = 'terrasphere_tool_overrides_v1';

export function loadCustomTools(): PlanetToolDef[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TOOLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PlanetToolDef =>
        Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && item.attributes),
    );
  } catch {
    return [];
  }
}

export function saveCustomTools(tools: PlanetToolDef[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(CUSTOM_TOOLS_STORAGE_KEY, JSON.stringify(tools));
  } catch {
    // ignore storage quota errors
  }
}

export function loadToolAttributeOverrides(): Record<string, Partial<ToolAttributes>> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(TOOL_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveToolAttributeOverrides(
  overrides: Record<string, Partial<ToolAttributes>>,
): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(TOOL_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // ignore storage quota errors
  }
}

export function resolveToolDefinition(
  toolId: string,
  customTools: ReadonlyArray<PlanetToolDef> = [],
  overrides: Record<string, Partial<ToolAttributes>> = {},
): PlanetToolDef {
  const found =
    customTools.find((t) => t.id === toolId) ??
    BUILTIN_TOOLS.find((t) => t.id === toolId) ??
    BUILTIN_TOOLS[2]; // default carve
  const ov = overrides[found.id];
  if (!ov) return found;
  return {
    ...found,
    attributes: {
      ...found.attributes,
      ...ov,
    },
  };
}

export function createCustomToolTemplate(
  behavior: ToolBehavior,
  partial?: Partial<Omit<PlanetToolDef, 'attributes'>> & {
    attributes?: Partial<ToolAttributes>;
  },
): PlanetToolDef {
  const preset =
    TOOL_BEHAVIOR_PRESETS.find((p) => p.behavior === behavior) ??
    TOOL_BEHAVIOR_PRESETS[0];
  const id =
    partial?.id ??
    `custom_${behavior}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  return {
    id,
    name: partial?.name ?? `自定${preset.label}`,
    desc: partial?.desc ?? preset.desc,
    group: 'custom',
    iconName: partial?.iconName ?? preset.defaultIcon,
    isCustom: true,
    attributes: {
      behavior,
      ...preset.defaults,
      colorHex: preset.defaultColor,
      ...partial?.attributes,
    },
  };
}

export const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  inspect: '探查',
  pierce: '射线贯通',
  cataclysm: '天灾核爆',
  sculpt: '造陆塑形',
  paint: '喷涂流霜',
  custom: '自定义工坊',
};
