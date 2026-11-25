// Periodic Table of Elements (1..118), Real Biochemical/Planetary Compounds,
// and Mineral/Elemental Voxel Material Compositions for 《Metabolism》.
// Note: Molar masses & stoichiometric element balances are compiled at initialization
// into numeric kernel tables; the PDE/ODE solver kernel NEVER parses formula strings at runtime.

import type { MaterialId } from '../voxelPlanet';

export type ElementCategory =
  | 'nonmetal'
  | 'noble_gas'
  | 'alkali_metal'
  | 'alkaline_earth'
  | 'metalloid'
  | 'halogen'
  | 'transition_metal'
  | 'post_transition'
  | 'lanthanide'
  | 'actinide';

export interface PeriodicElementDef {
  readonly atomicNumber: number;
  readonly symbol: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly atomicMassGPerMol: number;
  readonly period: number;
  readonly group: number; // 1..18 (lanthanides/actinides placed in group 3..17 row 8/9 for grid layout)
  readonly category: ElementCategory;
  readonly electronegativity: number | null;
  readonly commonValence: string;
  readonly cpkRgb: readonly [number, number, number];
  readonly bioGeoRole: string;
}

type RawElTuple = [
  number, // Z
  string, // symbol
  string, // nameZh
  string, // nameEn
  number, // atomicMass g/mol
  number, // period (1..7)
  number, // group (1..18)
  ElementCategory,
  number | null, // Pauling electronegativity
  string, // common valence
  readonly [number, number, number], // CPK rgb [0..1]
  string, // bioGeoRole
];

const RAW_ELEMENTS: ReadonlyArray<RawElTuple> = [
  [1, 'H', '氢', 'Hydrogen', 1.008, 1, 1, 'nonmetal', 2.2, '+1, -1', [0.95, 0.96, 0.98], '水分子、还原态质子梯度(ATP合酶)、有机骨架核心'],
  [2, 'He', '氦', 'Helium', 4.0026, 1, 18, 'noble_gas', null, '0', [0.85, 1.0, 1.0], '恒星核聚变产物与气态巨行星大气惰性组分'],
  [3, 'Li', '锂', 'Lithium', 6.94, 2, 1, 'alkali_metal', 0.98, '+1', [0.8, 0.5, 1.0], '火成岩伟晶痕量元素与电化学储能离子'],
  [4, 'Be', '铍', 'Beryllium', 9.0122, 2, 2, 'alkaline_earth', 1.57, '+2', [0.76, 1.0, 0.0], '绿柱石硅酸盐矿物晶格成分'],
  [5, 'B', '硼', 'Boron', 10.81, 2, 13, 'metalloid', 2.04, '+3', [1.0, 0.71, 0.71], '前生命核糖稳定剂与蒸发岩硼砂成分'],
  [6, 'C', '碳', 'Carbon', 12.011, 2, 14, 'nonmetal', 2.55, '+4, -4', [0.22, 0.25, 0.29], '星球碳循环(CO₂/CH₄/CaCO₃)与细胞有机大分子四价骨架'],
  [7, 'N', '氮', 'Nitrogen', 14.007, 2, 15, 'nonmetal', 3.04, '-3, +5', [0.19, 0.31, 0.97], '行星大气N₂、氨化还原、氨基酸/核苷酸关键元素'],
  [8, 'O', '氧', 'Oxygen', 15.999, 2, 16, 'nonmetal', 3.44, '-2', [0.94, 0.18, 0.18], '地壳硅酸盐主元素(46%)、水循环载体与有氧呼吸最终电子受体'],
  [9, 'F', '氟', 'Fluorine', 18.998, 2, 17, 'halogen', 3.98, '-1', [0.56, 0.88, 0.31], '萤石矿化与最强氧化电负性卤素'],
  [10, 'Ne', '氖', 'Neon', 20.18, 2, 18, 'noble_gas', null, '0', [0.7, 0.89, 0.96], '太阳风原始捕获惰性示踪气体'],
  [11, 'Na', '钠', 'Sodium', 22.99, 3, 1, 'alkali_metal', 0.93, '+1', [0.67, 0.36, 0.95], '海洋Na⁺盐度平衡与跨膜动作电位梯度离子'],
  [12, 'Mg', '镁', 'Magnesium', 24.305, 3, 2, 'alkaline_earth', 1.31, '+2', [0.54, 1.0, 0.0], '橄榄石/玄武岩核心阳离子、叶绿素螯合中心与ATP-Mg²⁺辅助因子'],
  [13, 'Al', '铝', 'Aluminum', 26.982, 3, 13, 'post_transition', 1.61, '+3', [0.75, 0.65, 0.65], '长石与黏土风化铝硅酸盐骨架'],
  [14, 'Si', '硅', 'Silicon', 28.085, 3, 14, 'metalloid', 1.9, '+4', [0.94, 0.78, 0.63], '岩石圈四面体硅酸盐(SiO₄⁴⁻)基石，决定行星地壳矿物相'],
  [15, 'P', '磷', 'Phosphorus', 30.974, 3, 15, 'nonmetal', 2.19, '+5, -3', [1.0, 0.5, 0.0], 'ATP高能磷酸键与磷脂双分子层生物膜极性头基'],
  [16, 'S', '硫', 'Sulfur', 32.06, 3, 16, 'nonmetal', 2.58, '-2, +6', [0.98, 0.85, 0.22], '海底热泉H₂S/黄铁矿(FeS₂)化能自养与半胱氨酸二硫键'],
  [17, 'Cl', '氯', 'Chlorine', 35.45, 3, 17, 'halogen', 3.16, '-1', [0.12, 0.94, 0.12], '海洋氯化物Cl⁻电中性平衡与渗透压调节'],
  [18, 'Ar', '氩', 'Argon', 39.948, 3, 18, 'noble_gas', null, '0', [0.5, 0.82, 0.89], '钾-氩放射性衰变地质测年大气组分'],
  [19, 'K', '钾', 'Potassium', 39.098, 4, 1, 'alkali_metal', 0.82, '+1', [0.56, 0.25, 0.83], '钾长石成岩离子、细胞内K⁺静息膜电位维持元素'],
  [20, 'Ca', '钙', 'Calcium', 40.078, 4, 2, 'alkaline_earth', 1.0, '+2', [0.24, 1.0, 0.0], '碳酸钙(CaCO₃)碳汇封存与生物矿化/细胞第二信使'],
  [21, 'Sc', '钪', 'Scandium', 44.956, 4, 3, 'transition_metal', 1.36, '+3', [0.9, 0.9, 0.9], '基性火成岩微量过渡金属'],
  [22, 'Ti', '钛', 'Titanium', 47.867, 4, 4, 'transition_metal', 1.54, '+4', [0.75, 0.76, 0.78], '钛铁矿高耐蚀地壳副矿物'],
  [23, 'V', '钒', 'Vanadium', 50.942, 4, 5, 'transition_metal', 1.63, '+5, +4', [0.65, 0.65, 0.67], '部分固氮酶氧化还原辅基'],
  [24, 'Cr', '铬', 'Chromium', 51.996, 4, 6, 'transition_metal', 1.66, '+3, +6', [0.54, 0.6, 0.78], '地幔铬铁矿示踪元素'],
  [25, 'Mn', '锰', 'Manganese', 54.938, 4, 7, 'transition_metal', 1.55, '+2, +4', [0.61, 0.48, 0.78], '光合放氧复合体(Mn₄CaO₅)裂解水催化核心'],
  [26, 'Fe', '铁', 'Iron', 55.845, 4, 8, 'transition_metal', 1.83, '+2, +3', [0.88, 0.4, 0.2], '行星金属核、玄武岩磁铁矿、Fe-S簇与血红素电子传递链'],
  [27, 'Co', '钴', 'Cobalt', 58.933, 4, 9, 'transition_metal', 1.88, '+2, +3', [0.94, 0.56, 0.63], '钴胺素(维生素B₁₂)一碳代谢中心金属'],
  [28, 'Ni', '镍', 'Nickel', 58.693, 4, 10, 'transition_metal', 1.91, '+2', [0.31, 0.82, 0.31], '产甲烷菌F430辅酶与铁镍行星核合金'],
  [29, 'Cu', '铜', 'Copper', 63.546, 4, 11, 'transition_metal', 1.9, '+1, +2', [0.78, 0.5, 0.2], '细胞色素c氧化酶末端呼吸电子传递中心'],
  [30, 'Zn', '锌', 'Zinc', 65.38, 4, 12, 'transition_metal', 1.65, '+2', [0.49, 0.5, 0.69], '碳酸酐酶(CO₂⇌HCO₃⁻)与基因转录锌指结构'],
  [31, 'Ga', '镓', 'Gallium', 69.723, 4, 13, 'post_transition', 1.81, '+3', [0.76, 0.56, 0.56], '铝土矿伴生稀散金属'],
  [32, 'Ge', '锗', 'Germanium', 72.63, 4, 14, 'metalloid', 2.01, '+4', [0.4, 0.56, 0.56], '硅酸盐晶格类质同象替代半导体'],
  [33, 'As', '砷', 'Arsenic', 74.922, 4, 15, 'metalloid', 2.18, '+3, +5', [0.74, 0.5, 0.89], '热泉硫化物极端微生物电子供/受体'],
  [34, 'Se', '硒', 'Selenium', 78.971, 4, 16, 'nonmetal', 2.55, '-2, +4', [1.0, 0.63, 0.0], '硒代半胱氨酸抗氧化酶活性中心'],
  [35, 'Br', '溴', 'Bromine', 79.904, 4, 17, 'halogen', 2.96, '-1', [0.65, 0.16, 0.16], '海相卤水痕量卤素'],
  [36, 'Kr', '氪', 'Krypton', 83.798, 4, 18, 'noble_gas', 3.0, '0', [0.36, 0.72, 0.82], '大气重惰性气体示踪剂'],
  [37, 'Rb', '铷', 'Rubidium', 85.468, 5, 1, 'alkali_metal', 0.82, '+1', [0.44, 0.18, 0.69], 'Rb-Sr同位素岩石定年示踪元素'],
  [38, 'Sr', '锶', 'Strontium', 87.62, 5, 2, 'alkaline_earth', 0.95, '+2', [0.0, 1.0, 0.0], '海洋碳酸盐古温度替代指标元素'],
  [39, 'Y', '钇', 'Yttrium', 88.906, 5, 3, 'transition_metal', 1.22, '+3', [0.58, 1.0, 1.0], '稀土矿物高温超导与氧化物成分'],
  [40, 'Zr', '锆', 'Zirconium', 91.224, 5, 4, 'transition_metal', 1.33, '+4', [0.58, 0.88, 0.88], '锆石(ZrSiO₄)最古老地壳U-Pb测年载体'],
  [41, 'Nb', '铌', 'Niobium', 92.906, 5, 5, 'transition_metal', 1.6, '+5', [0.45, 0.76, 0.79], '碱性岩高场强耐火元素'],
  [42, 'Mo', '钼', 'Molybdenum', 95.95, 5, 6, 'transition_metal', 2.16, '+6, +4', [0.33, 0.71, 0.71], '生物固氮酶(MoFe蛋白)核心辅因子'],
  [43, 'Tc', '锝', 'Technetium', 98.0, 5, 7, 'transition_metal', 1.9, '+7', [0.23, 0.62, 0.62], '人造/短寿期裂变放射性过渡金属'],
  [44, 'Ru', '钌', 'Ruthenium', 101.07, 5, 8, 'transition_metal', 2.2, '+3, +4', [0.14, 0.56, 0.56], '铂族地幔铁陨石分异示踪元素'],
  [45, 'Rh', '铑', 'Rhodium', 102.91, 5, 9, 'transition_metal', 2.28, '+3', [0.04, 0.49, 0.55], '铂族强加氢催化剂'],
  [46, 'Pd', '钯', 'Palladium', 106.42, 5, 10, 'transition_metal', 2.2, '+2', [0.0, 0.41, 0.52], '储氢铂族催化金属'],
  [47, 'Ag', '银', 'Silver', 107.87, 5, 11, 'transition_metal', 1.93, '+1', [0.75, 0.75, 0.75], '热液硫化物矿床贵金属'],
  [48, 'Cd', '镉', 'Cadmium', 112.41, 5, 12, 'transition_metal', 1.69, '+2', [1.0, 0.85, 0.56], '部分海洋硅藻碳酸酐酶代用锌金属'],
  [49, 'In', '铟', 'Indium', 114.82, 5, 13, 'post_transition', 1.78, '+3', [0.65, 0.46, 0.45], '硫化物闪锌矿伴生金属'],
  [50, 'Sn', '锡', 'Tin', 118.71, 5, 14, 'post_transition', 1.96, '+2, +4', [0.4, 0.5, 0.5], '花岗岩锡石矿化金属'],
  [51, 'Sb', '锑', 'Antimony', 121.76, 5, 15, 'metalloid', 2.05, '+3, +5', [0.62, 0.39, 0.71], '低温热液辉锑矿组分'],
  [52, 'Te', '碲', 'Tellurium', 127.6, 5, 16, 'metalloid', 2.1, '-2, +4', [0.83, 0.48, 0.0], '稀散热液硫族元素'],
  [53, 'I', '碘', 'Iodine', 126.9, 5, 17, 'halogen', 2.66, '-1', [0.58, 0.0, 0.58], '海藻富集与高等生物甲状腺代谢激素元素'],
  [54, 'Xe', '氙', 'Xenon', 131.29, 5, 18, 'noble_gas', 2.6, '0', [0.26, 0.62, 0.69], '行星早期大气逃逸示踪重惰性气体'],
  [55, 'Cs', '铯', 'Cesium', 132.91, 6, 1, 'alkali_metal', 0.79, '+1', [0.34, 0.09, 0.56], '原子钟超精细能级基准元素'],
  [56, 'Ba', '钡', 'Barium', 137.33, 6, 2, 'alkaline_earth', 0.89, '+2', [0.0, 0.79, 0.0], '深海重晶石(BaSO₄)海洋生产力指示矿物'],
  [57, 'La', '镧', 'Lanthanum', 138.91, 6, 3, 'lanthanide', 1.1, '+3', [0.44, 0.83, 1.0], '轻稀土分异地球化学标准'],
  [58, 'Ce', '铈', 'Cerium', 140.12, 6, 4, 'lanthanide', 1.12, '+3, +4', [1.0, 1.0, 0.78], '古海洋氧化还原(Ce异常)示踪稀土'],
  [59, 'Pr', '镨', 'Praseodymium', 140.91, 6, 5, 'lanthanide', 1.13, '+3', [0.85, 1.0, 0.78], '稀土光学晶体掺杂元素'],
  [60, 'Nd', '钕', 'Neodymium', 144.24, 6, 6, 'lanthanide', 1.14, '+3', [0.78, 1.0, 0.78], 'Sm-Nd地幔演化同位素定年与强磁材料'],
  [61, 'Pm', '钷', 'Promethium', 145.0, 6, 7, 'lanthanide', 1.13, '+3', [0.64, 1.0, 0.78], '放射性稀土裂变产物'],
  [62, 'Sm', '钐', 'Samarium', 150.36, 6, 8, 'lanthanide', 1.17, '+3', [0.56, 1.0, 0.78], 'Sm-Nd地壳分异母体核素'],
  [63, 'Eu', '铕', 'Europium', 151.96, 6, 9, 'lanthanide', 1.2, '+2, +3', [0.38, 1.0, 0.78], '斜长石岩浆分异Eu异常示踪稀土'],
  [64, 'Gd', '钆', 'Gadolinium', 157.25, 6, 10, 'lanthanide', 1.2, '+3', [0.27, 1.0, 0.78], '强顺磁稀土造影金属'],
  [65, 'Tb', '铽', 'Terbium', 158.93, 6, 11, 'lanthanide', 1.2, '+3', [0.19, 1.0, 0.78], '稀土荧光发光中心元素'],
  [66, 'Dy', '镝', 'Dysprosium', 162.5, 6, 12, 'lanthanide', 1.22, '+3', [0.12, 1.0, 0.78], '高温永磁矫顽力稀土'],
  [67, 'Ho', '钬', 'Holmium', 164.93, 6, 13, 'lanthanide', 1.23, '+3', [0.0, 1.0, 0.61], '高磁矩稀土元素'],
  [68, 'Er', '铒', 'Erbium', 167.26, 6, 14, 'lanthanide', 1.24, '+3', [0.0, 0.9, 0.46], '光放大稀土掺杂离子'],
  [69, 'Tm', '铥', 'Thulium', 168.93, 6, 15, 'lanthanide', 1.25, '+3', [0.0, 0.83, 0.32], '稀有重稀土元素'],
  [70, 'Yb', '镱', 'Ytterbium', 173.05, 6, 16, 'lanthanide', 1.1, '+2, +3', [0.0, 0.75, 0.22], '石榴石相变重稀土示踪元素'],
  [71, 'Lu', '镥', 'Lutetium', 174.97, 6, 17, 'lanthanide', 1.27, '+3', [0.0, 0.67, 0.14], 'Lu-Hf早太古代地壳定年核素'],
  [72, 'Hf', '铪', 'Hafnium', 178.49, 6, 4, 'transition_metal', 1.3, '+4', [0.3, 0.76, 1.0], '锆石抗风化高场强示踪金属'],
  [73, 'Ta', '钽', 'Tantalum', 180.95, 6, 5, 'transition_metal', 1.5, '+5', [0.3, 0.65, 1.0], '伟晶岩抗腐蚀耐火金属'],
  [74, 'W', '钨', 'Tungsten', 183.84, 6, 6, 'transition_metal', 2.36, '+6', [0.13, 0.58, 0.84], '高温嗜热古菌醛氧化还原酶金属中心'],
  [75, 'Re', '铼', 'Rhenium', 186.21, 6, 7, 'transition_metal', 1.9, '+7', [0.15, 0.49, 0.67], 'Re-Os亲铁地质定年元素'],
  [76, 'Os', '锇', 'Osmium', 190.23, 6, 8, 'transition_metal', 2.2, '+4, +8', [0.15, 0.4, 0.59], '高密度亲铁地核示踪金属'],
  [77, 'Ir', '铱', 'Iridium', 192.22, 6, 9, 'transition_metal', 2.2, '+3, +4', [0.09, 0.33, 0.53], '小行星撞击K-Pg界线富集标志元素'],
  [78, 'Pt', '铂', 'Platinum', 195.08, 6, 10, 'transition_metal', 2.28, '+2, +4', [0.82, 0.82, 0.88], '贵金属析氢/氧还原催化剂'],
  [79, 'Au', '金', 'Gold', 196.97, 6, 11, 'transition_metal', 2.54, '+1, +3', [1.0, 0.82, 0.14], '中子星合并快中子俘获产物与热液金矿'],
  [80, 'Hg', '汞', 'Mercury', 200.59, 6, 12, 'transition_metal', 2.0, '+1, +2', [0.72, 0.72, 0.82], '常温液态亲硫重金属'],
  [81, 'Tl', '铊', 'Thallium', 204.38, 6, 13, 'post_transition', 1.62, '+1, +3', [0.65, 0.33, 0.3], '氧化还原敏感古海洋示踪元素'],
  [82, 'Pb', '铅', 'Lead', 207.2, 6, 14, 'post_transition', 2.33, '+2', [0.34, 0.35, 0.38], '铀/钍放射性衰变终点核素(方铅矿PbS)'],
  [83, 'Bi', '铋', 'Bismuth', 208.98, 6, 15, 'post_transition', 2.02, '+3', [0.62, 0.31, 0.71], '低熔点重主族逆磁金属'],
  [84, 'Po', '钋', 'Polonium', 209.0, 6, 16, 'metalloid', 2.0, '+2, +4', [0.67, 0.36, 0.0], '铀衰变链α辐射核素'],
  [85, 'At', '砹', 'Astatine', 210.0, 6, 17, 'halogen', 2.2, '-1, +1', [0.46, 0.31, 0.27], '极罕见短寿期重卤素'],
  [86, 'Rn', '氡', 'Radon', 222.0, 6, 18, 'noble_gas', null, '0', [0.26, 0.51, 0.59], '地壳断裂带释放放射性惰性气体'],
  [87, 'Fr', '钫', 'Francium', 223.0, 7, 1, 'alkali_metal', 0.7, '+1', [0.26, 0.0, 0.4], '极不稳定重碱金属'],
  [88, 'Ra', '镭', 'Radium', 226.0, 7, 2, 'alkaline_earth', 0.9, '+2', [0.0, 0.49, 0.0], '海洋地下水定年放射性碱土金属'],
  [89, 'Ac', '锕', 'Actinium', 227.0, 7, 3, 'actinide', 1.1, '+3', [0.44, 0.67, 0.98], '锕系衰变母体元素'],
  [90, 'Th', '钍', 'Thorium', 232.04, 7, 4, 'actinide', 1.3, '+4', [0.0, 0.73, 1.0], '行星地幔长寿期放射性生热核心元素(14 Gyr半衰期)'],
  [91, 'Pa', '镤', 'Protactinium', 231.04, 7, 5, 'actinide', 1.5, '+5', [0.0, 0.63, 1.0], '海洋颗粒沉降速率示踪核素'],
  [92, 'U', '铀', 'Uranium', 238.03, 7, 6, 'actinide', 1.38, '+4, +6', [0.0, 0.56, 1.0], '驱动行星地核热对流与板块构造的核心生热核素'],
  [93, 'Np', '镎', 'Neptunium', 237.0, 7, 7, 'actinide', 1.36, '+5', [0.0, 0.5, 1.0], '超铀中子俘获核素'],
  [94, 'Pu', '钚', 'Plutonium', 244.0, 7, 8, 'actinide', 1.28, '+4', [0.0, 0.42, 1.0], '太阳系早期灭绝放射性²⁴⁴Pu示踪热源'],
  [95, 'Am', '镅', 'Americium', 243.0, 7, 9, 'actinide', 1.3, '+3', [0.33, 0.36, 0.95], '人造超铀锕系同位素'],
  [96, 'Cm', '锔', 'Curium', 247.0, 7, 10, 'actinide', 1.3, '+3', [0.47, 0.36, 0.89], '深空探测器α粒子谱仪激发源'],
  [97, 'Bk', '锫', 'Berkelium', 247.0, 7, 11, 'actinide', 1.3, '+3, +4', [0.54, 0.31, 0.89], '合成重锕系靶材核素'],
  [98, 'Cf', '锎', 'Californium', 251.0, 7, 12, 'actinide', 1.3, '+3', [0.63, 0.21, 0.83], '强自发裂变中子源'],
  [99, 'Es', '锿', 'Einsteinium', 252.0, 7, 13, 'actinide', 1.3, '+3', [0.7, 0.12, 0.83], '高能核合成锕系元素'],
  [100, 'Fm', '镄', 'Fermium', 257.0, 7, 14, 'actinide', 1.3, '+3', [0.7, 0.12, 0.73], '热核瞬时中子俘获极限元素'],
  [101, 'Md', '钔', 'Mendelevium', 258.0, 7, 15, 'actinide', 1.3, '+2, +3', [0.7, 0.05, 0.65], '重离子轰击合成锕系'],
  [102, 'No', '锘', 'Nobelium', 259.0, 7, 16, 'actinide', 1.3, '+2', [0.74, 0.05, 0.53], '偏向+2氧化态的重锕系'],
  [103, 'Lr', '铹', 'Lawrencium', 266.0, 7, 17, 'actinide', 1.3, '+3', [0.78, 0.0, 0.4], '锕系末尾过渡界线元素'],
  [104, 'Rf', '𬬻', 'Rutherfordium', 267.0, 7, 4, 'transition_metal', null, '+4', [0.8, 0.0, 0.35], '超重第4族人工合成核素'],
  [105, 'Db', '𬭊', 'Dubnium', 268.0, 7, 5, 'transition_metal', null, '+5', [0.82, 0.0, 0.31], '超重第5族人工合成核素'],
  [106, 'Sg', '𬭳', 'Seaborgium', 269.0, 7, 6, 'transition_metal', null, '+6', [0.85, 0.0, 0.27], '超重第6族人工合成核素'],
  [107, 'Bh', '𬭛', 'Bohrium', 270.0, 7, 7, 'transition_metal', null, '+7', [0.88, 0.0, 0.22], '超重第7族人工合成核素'],
  [108, 'Hs', '𬭶', 'Hassium', 277.0, 7, 8, 'transition_metal', null, '+8', [0.9, 0.0, 0.18], '超重第8族人工合成核素'],
  [109, 'Mt', '鿏', 'Meitnerium', 278.0, 7, 9, 'transition_metal', null, '+3', [0.92, 0.0, 0.15], '超重第9族人工合成核素'],
  [110, 'Ds', '𫟼', 'Darmstadtium', 281.0, 7, 10, 'transition_metal', null, '+2', [0.93, 0.0, 0.13], '超重第10族人工合成核素'],
  [111, 'Rg', '𬬭', 'Roentgenium', 282.0, 7, 11, 'transition_metal', null, '+3', [0.94, 0.0, 0.11], '超重第11族人工合成核素'],
  [112, 'Cn', '鿔', 'Copernicium', 285.0, 7, 12, 'transition_metal', null, '+2', [0.95, 0.0, 0.1], '相对论效应显著的超重金属'],
  [113, 'Nh', '鿭', 'Nihonium', 286.0, 7, 13, 'post_transition', null, '+1', [0.96, 0.1, 0.15], '超重第13族人工合成核素'],
  [114, 'Fl', '𫓧', 'Flerovium', 289.0, 7, 14, 'post_transition', null, '+2', [0.96, 0.16, 0.22], '近闭壳稳定岛超重元素'],
  [115, 'Mc', '镆', 'Moscovium', 290.0, 7, 15, 'post_transition', null, '+1, +3', [0.96, 0.22, 0.28], '超重第15族人工合成核素'],
  [116, 'Lv', '𫟷', 'Livermorium', 293.0, 7, 16, 'post_transition', null, '+2', [0.96, 0.28, 0.34], '超重第16族人工合成核素'],
  [117, 'Ts', '鿬', 'Tennessine', 294.0, 7, 17, 'halogen', null, '-1, +1', [0.96, 0.34, 0.4], '超重第17族人工合成核素'],
  [118, 'Og', '鿫', 'Oganesson', 294.0, 7, 18, 'noble_gas', null, '0', [0.96, 0.4, 0.48], '已知最重118号闭壳人工合成元素'],
];

export const PERIODIC_ELEMENTS: ReadonlyArray<PeriodicElementDef> = RAW_ELEMENTS.map((t) => ({
  atomicNumber: t[0],
  symbol: t[1],
  nameZh: t[2],
  nameEn: t[3],
  atomicMassGPerMol: t[4],
  period: t[5],
  group: t[6],
  category: t[7],
  electronegativity: t[8],
  commonValence: t[9],
  cpkRgb: t[10],
  bioGeoRole: t[11],
}));

const ELEMENT_BY_SYMBOL = new Map<string, PeriodicElementDef>(
  PERIODIC_ELEMENTS.map((el) => [el.symbol, el]),
);
const ELEMENT_BY_Z = new Map<number, PeriodicElementDef>(
  PERIODIC_ELEMENTS.map((el) => [el.atomicNumber, el]),
);

export function getElementBySymbol(symbol: string): PeriodicElementDef | undefined {
  return ELEMENT_BY_SYMBOL.get(symbol);
}

export function getElementByNumber(z: number): PeriodicElementDef | undefined {
  return ELEMENT_BY_Z.get(z);
}

/**
 * Computes exact compound molar mass in kg/mol directly from IUPAC periodic atomic masses.
 */
export function computeCompoundMolarMassKgPerMol(atoms: Readonly<Record<string, number>>): number {
  let gPerMol = 0;
  for (const sym of Object.keys(atoms)) {
    const count = atoms[sym] ?? 0;
    if (count <= 0) continue;
    const el = ELEMENT_BY_SYMBOL.get(sym);
    if (!el) {
      throw new Error(`Unknown element symbol '${sym}' in compound composition`);
    }
    gPerMol += el.atomicMassGPerMol * count;
  }
  // Round to 6 decimal places in kg/mol to avoid IEEE-754 summation drift across balanced equations
  return Math.round(gPerMol * 1e3) / 1e6;
}

export type CompoundDomain = 'atmosphere' | 'hydrosphere' | 'biochemistry' | 'lithosphere';

export interface CompoundDef {
  readonly id: string;
  readonly formulaTag: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly domain: CompoundDomain;
  readonly atoms: Readonly<Record<string, number>>;
  readonly molarMassKgPerMol: number;
  readonly standardPhase298K: 'solid' | 'liquid' | 'gas' | 'aqueous';
  readonly densityKgM3: number;
  readonly specificHeatJPerMolK: number;
  readonly diffusivityM2s: number;
  readonly colorRgb: readonly [number, number, number];
  readonly roleSummary: string;
}

interface RawCompoundDef {
  readonly id: string;
  readonly formulaTag: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly domain: CompoundDomain;
  readonly atoms: Readonly<Record<string, number>>;
  readonly standardPhase298K: 'solid' | 'liquid' | 'gas' | 'aqueous';
  readonly densityKgM3: number;
  readonly specificHeatJPerMolK: number;
  readonly diffusivityM2s: number;
  readonly colorRgb: readonly [number, number, number];
  readonly roleSummary: string;
}

const RAW_COMPOUNDS: ReadonlyArray<RawCompoundDef> = [
  {
    id: 'CO2',
    formulaTag: 'CO₂',
    nameZh: '二氧化碳',
    nameEn: 'Carbon Dioxide',
    domain: 'atmosphere',
    atoms: { C: 1, O: 2 },
    standardPhase298K: 'gas',
    densityKgM3: 1.977,
    specificHeatJPerMolK: 37.1,
    diffusivityM2s: 0.16,
    colorRgb: [0.96, 0.56, 0.22],
    roleSummary: '大气温室气体、光合固碳底物与呼吸终产物',
  },
  {
    id: 'H2Og',
    formulaTag: 'H₂O(g)',
    nameZh: '水蒸气',
    nameEn: 'Water Vapor',
    domain: 'atmosphere',
    atoms: { H: 2, O: 1 },
    standardPhase298K: 'gas',
    densityKgM3: 0.804,
    specificHeatJPerMolK: 33.6,
    diffusivityM2s: 0.24,
    colorRgb: [0.76, 0.9, 1.0],
    roleSummary: '水循环气相潜热搬运载体与云凝结核前体',
  },
  {
    id: 'H2Ol',
    formulaTag: 'H₂O(l)',
    nameZh: '液态水',
    nameEn: 'Liquid Water',
    domain: 'hydrosphere',
    atoms: { H: 2, O: 1 },
    standardPhase298K: 'liquid',
    densityKgM3: 997,
    specificHeatJPerMolK: 75.3,
    diffusivityM2s: 0.055,
    colorRgb: [0.1, 0.62, 0.98],
    roleSummary: '行星海洋基质与细胞生化反应通用溶剂',
  },
  {
    id: 'H2Os',
    formulaTag: 'H₂O(s)',
    nameZh: '水冰晶',
    nameEn: 'Water Ice',
    domain: 'hydrosphere',
    atoms: { H: 2, O: 1 },
    standardPhase298K: 'solid',
    densityKgM3: 917,
    specificHeatJPerMolK: 38.0,
    diffusivityM2s: 0.008,
    colorRgb: [0.82, 0.94, 1.0],
    roleSummary: '极地高反照率冰盖与淡水长期固态储库',
  },
  {
    id: 'O2',
    formulaTag: 'O₂',
    nameZh: '分子氧',
    nameEn: 'Dioxygen',
    domain: 'atmosphere',
    atoms: { O: 2 },
    standardPhase298K: 'gas',
    densityKgM3: 1.429,
    specificHeatJPerMolK: 29.4,
    diffusivityM2s: 0.19,
    colorRgb: [0.28, 0.88, 0.92],
    roleSummary: '产氧光合产物与高产能线粒体呼吸电子受体',
  },
  {
    id: 'N2',
    formulaTag: 'N₂',
    nameZh: '氮气',
    nameEn: 'Dinitrogen',
    domain: 'atmosphere',
    atoms: { N: 2 },
    standardPhase298K: 'gas',
    densityKgM3: 1.251,
    specificHeatJPerMolK: 29.1,
    diffusivityM2s: 0.18,
    colorRgb: [0.46, 0.56, 0.94],
    roleSummary: '大气背景缓冲气体与生物固氮原料',
  },
  {
    id: 'CH4',
    formulaTag: 'CH₄',
    nameZh: '甲烷',
    nameEn: 'Methane',
    domain: 'atmosphere',
    atoms: { C: 1, H: 4 },
    standardPhase298K: 'gas',
    densityKgM3: 0.717,
    specificHeatJPerMolK: 35.7,
    diffusivityM2s: 0.21,
    colorRgb: [0.92, 0.34, 0.76],
    roleSummary: '厌氧产甲烷代谢产物与强效碳循环温室气体',
  },
  {
    id: 'H2',
    formulaTag: 'H₂',
    nameZh: '氢气',
    nameEn: 'Dihydrogen',
    domain: 'atmosphere',
    atoms: { H: 2 },
    standardPhase298K: 'gas',
    densityKgM3: 0.0899,
    specificHeatJPerMolK: 28.8,
    diffusivityM2s: 0.38,
    colorRgb: [0.95, 0.95, 0.99],
    roleSummary: '热泉蛇纹石化还原力来源与原初生命电子供体',
  },
  {
    id: 'NH3',
    formulaTag: 'NH₃',
    nameZh: '氨气',
    nameEn: 'Ammonia',
    domain: 'atmosphere',
    atoms: { N: 1, H: 3 },
    standardPhase298K: 'gas',
    densityKgM3: 0.769,
    specificHeatJPerMolK: 35.1,
    diffusivityM2s: 0.17,
    colorRgb: [0.48, 0.72, 1.0],
    roleSummary: '氨基酸合成氮源与弱碱性溶液调节剂',
  },
  {
    id: 'H2S',
    formulaTag: 'H₂S',
    nameZh: '硫化氢',
    nameEn: 'Hydrogen Sulfide',
    domain: 'atmosphere',
    atoms: { H: 2, S: 1 },
    standardPhase298K: 'gas',
    densityKgM3: 1.539,
    specificHeatJPerMolK: 34.2,
    diffusivityM2s: 0.14,
    colorRgb: [0.95, 0.85, 0.24],
    roleSummary: '深海热泉无光化能自养电子供体',
  },
  {
    id: 'SO2',
    formulaTag: 'SO₂',
    nameZh: '二氧化硫',
    nameEn: 'Sulfur Dioxide',
    domain: 'atmosphere',
    atoms: { S: 1, O: 2 },
    standardPhase298K: 'gas',
    densityKgM3: 2.927,
    specificHeatJPerMolK: 39.9,
    diffusivityM2s: 0.12,
    colorRgb: [0.92, 0.72, 0.25],
    roleSummary: '火山脱气酸性气体与硫酸盐气溶胶前体',
  },
  {
    id: 'CO',
    formulaTag: 'CO',
    nameZh: '一氧化碳',
    nameEn: 'Carbon Monoxide',
    domain: 'atmosphere',
    atoms: { C: 1, O: 1 },
    standardPhase298K: 'gas',
    densityKgM3: 1.25,
    specificHeatJPerMolK: 29.1,
    diffusivityM2s: 0.18,
    colorRgb: [0.78, 0.42, 0.34],
    roleSummary: '不完全氧化中间体与原初乙酰辅酶A通路碳源',
  },
  {
    id: 'H2CO3',
    formulaTag: 'H₂CO₃',
    nameZh: '碳酸',
    nameEn: 'Carbonic Acid',
    domain: 'hydrosphere',
    atoms: { H: 2, C: 1, O: 3 },
    standardPhase298K: 'aqueous',
    densityKgM3: 1020,
    specificHeatJPerMolK: 82.0,
    diffusivityM2s: 0.048,
    colorRgb: [0.24, 0.78, 0.88],
    roleSummary: '海气碳平衡缓冲区与岩石硅酸盐化学风化剂',
  },
  {
    id: 'C6H12O6',
    formulaTag: 'C₆H₁₂O₆',
    nameZh: '葡萄糖',
    nameEn: 'Glucose',
    domain: 'biochemistry',
    atoms: { C: 6, H: 12, O: 6 },
    standardPhase298K: 'aqueous',
    densityKgM3: 1540,
    specificHeatJPerMolK: 218.0,
    diffusivityM2s: 0.032,
    colorRgb: [0.98, 0.78, 0.22],
    roleSummary: '细胞核心碳能枢纽：有氧TCA呼吸与无氧糖酵解公共底物',
  },
  {
    id: 'CH2O',
    formulaTag: 'CH₂O',
    nameZh: '有机碳/糖类单体',
    nameEn: 'Organic Biomass Unit',
    domain: 'biochemistry',
    atoms: { C: 1, H: 2, O: 1 },
    standardPhase298K: 'solid',
    densityKgM3: 1320,
    specificHeatJPerMolK: 48.0,
    diffusivityM2s: 0.025,
    colorRgb: [0.18, 0.9, 0.48],
    roleSummary: '光合固碳生物量基本计量单位与细胞骨架同化碳库',
  },
  {
    id: 'C3H6O3',
    formulaTag: 'C₃H₆O₃',
    nameZh: '乳酸',
    nameEn: 'Lactate',
    domain: 'biochemistry',
    atoms: { C: 3, H: 6, O: 3 },
    standardPhase298K: 'aqueous',
    densityKgM3: 1209,
    specificHeatJPerMolK: 127.0,
    diffusivityM2s: 0.044,
    colorRgb: [0.96, 0.34, 0.48],
    roleSummary: '缺氧条件下糖酵解发酵产物，引发胞外微环境酸化',
  },
  {
    id: 'ATP',
    formulaTag: 'ATP (C₁₀H₁₆N₅O₁₃P₃)',
    nameZh: '三磷酸腺苷',
    nameEn: 'Adenosine Triphosphate',
    domain: 'biochemistry',
    atoms: { C: 10, H: 16, N: 5, O: 13, P: 3 },
    standardPhase298K: 'aqueous',
    densityKgM3: 1620,
    specificHeatJPerMolK: 340.0,
    diffusivityM2s: 0.02,
    colorRgb: [1.0, 0.88, 0.25],
    roleSummary: '细胞通用能量通货：磷酸酐键水解释放30.5 kJ/mol驱动代谢',
  },
  {
    id: 'ADP',
    formulaTag: 'ADP (C₁₀H₁₅N₅O₁₀P₂)',
    nameZh: '二磷酸腺苷',
    nameEn: 'Adenosine Diphosphate',
    domain: 'biochemistry',
    atoms: { C: 10, H: 15, N: 5, O: 10, P: 2 },
    standardPhase298K: 'aqueous',
    densityKgM3: 1580,
    specificHeatJPerMolK: 295.0,
    diffusivityM2s: 0.024,
    colorRgb: [0.85, 0.58, 0.25],
    roleSummary: 'ATP水解后的能量受载体，经氧化磷酸化再生为ATP',
  },
  {
    id: 'GLYCINE',
    formulaTag: 'C₂H₅NO₂',
    nameZh: '甘氨酸',
    nameEn: 'Glycine',
    domain: 'biochemistry',
    atoms: { C: 2, H: 5, N: 1, O: 2 },
    standardPhase298K: 'aqueous',
    densityKgM3: 1161,
    specificHeatJPerMolK: 99.0,
    diffusivityM2s: 0.042,
    colorRgb: [0.62, 0.48, 0.98],
    roleSummary: '最简单前生命蛋白质单体，含氨基(-NH₂)与羧基(-COOH)',
  },
  {
    id: 'PHOSPHOLIPID',
    formulaTag: 'C₄₂H₈₂NO₈P',
    nameZh: '磷脂双层分子',
    nameEn: 'Phosphatidylcholine',
    domain: 'biochemistry',
    atoms: { C: 42, H: 82, N: 1, O: 8, P: 1 },
    standardPhase298K: 'solid',
    densityKgM3: 1015,
    specificHeatJPerMolK: 680.0,
    diffusivityM2s: 0.004,
    colorRgb: [0.22, 0.86, 0.72],
    roleSummary: '两亲性自组装原生细胞质膜骨架，隔绝内外建立化学渗透势',
  },
  {
    id: 'SiO2',
    formulaTag: 'SiO₂',
    nameZh: '二氧化硅 (石英)',
    nameEn: 'Quartz / Silica',
    domain: 'lithosphere',
    atoms: { Si: 1, O: 2 },
    standardPhase298K: 'solid',
    densityKgM3: 2650,
    specificHeatJPerMolK: 44.4,
    diffusivityM2s: 0.002,
    colorRgb: [0.82, 0.76, 0.66],
    roleSummary: '大陆地壳硅铝层主力抗风化造岩矿物',
  },
  {
    id: 'CaCO3',
    formulaTag: 'CaCO₃',
    nameZh: '碳酸钙 (方解石)',
    nameEn: 'Calcite',
    domain: 'lithosphere',
    atoms: { Ca: 1, C: 1, O: 3 },
    standardPhase298K: 'solid',
    densityKgM3: 2710,
    specificHeatJPerMolK: 81.9,
    diffusivityM2s: 0.003,
    colorRgb: [0.88, 0.86, 0.82],
    roleSummary: '行星长期无机碳汇矿物与生物骨骼矿化壳体',
  },
  {
    id: 'Mg2SiO4',
    formulaTag: 'Mg₂SiO₄',
    nameZh: '镁橄榄石',
    nameEn: 'Forsterite Olivine',
    domain: 'lithosphere',
    atoms: { Mg: 2, Si: 1, O: 4 },
    standardPhase298K: 'solid',
    densityKgM3: 3270,
    specificHeatJPerMolK: 118.6,
    diffusivityM2s: 0.002,
    colorRgb: [0.38, 0.56, 0.34],
    roleSummary: '地幔及玄武岩基性矿物，热液蛇纹石化可析出H₂驱动起源代谢',
  },
  {
    id: 'Fe3O4',
    formulaTag: 'Fe₃O₄',
    nameZh: '磁铁矿',
    nameEn: 'Magnetite',
    domain: 'lithosphere',
    atoms: { Fe: 3, O: 4 },
    standardPhase298K: 'solid',
    densityKgM3: 5170,
    specificHeatJPerMolK: 143.4,
    diffusivityM2s: 0.001,
    colorRgb: [0.24, 0.26, 0.32],
    roleSummary: '玄武岩强磁性氧化铁矿物，记录古行星磁场极性',
  },
  {
    id: 'Fe2O3',
    formulaTag: 'Fe₂O₃',
    nameZh: '赤铁矿',
    nameEn: 'Hematite',
    domain: 'lithosphere',
    atoms: { Fe: 2, O: 3 },
    standardPhase298K: 'solid',
    densityKgM3: 5260,
    specificHeatJPerMolK: 103.9,
    diffusivityM2s: 0.001,
    colorRgb: [0.72, 0.28, 0.22],
    roleSummary: '大氧化事件(GOE)条带状铁建造沉积标志矿物',
  },
  {
    id: 'FeS2',
    formulaTag: 'FeS₂',
    nameZh: '黄铁矿',
    nameEn: 'Pyrite',
    domain: 'lithosphere',
    atoms: { Fe: 1, S: 2 },
    standardPhase298K: 'solid',
    densityKgM3: 5010,
    specificHeatJPerMolK: 62.2,
    diffusivityM2s: 0.002,
    colorRgb: [0.78, 0.68, 0.34],
    roleSummary: '热泉铁硫世界起源假说催化表面矿物',
  },
  {
    id: 'KAlSi3O8',
    formulaTag: 'KAlSi₃O₈',
    nameZh: '钾长石',
    nameEn: 'Orthoclase Feldspar',
    domain: 'lithosphere',
    atoms: { K: 1, Al: 1, Si: 3, O: 8 },
    standardPhase298K: 'solid',
    densityKgM3: 2560,
    specificHeatJPerMolK: 202.0,
    diffusivityM2s: 0.0015,
    colorRgb: [0.85, 0.72, 0.68],
    roleSummary: '花岗岩风化碳酸化消耗CO₂生成黏土的主体硅酸盐',
  },
  {
    id: 'CaAl2Si2O8',
    formulaTag: 'CaAl₂Si₂O₈',
    nameZh: '钙长石',
    nameEn: 'Anorthite Plagioclase',
    domain: 'lithosphere',
    atoms: { Ca: 1, Al: 2, Si: 2, O: 8 },
    standardPhase298K: 'solid',
    densityKgM3: 2760,
    specificHeatJPerMolK: 211.0,
    diffusivityM2s: 0.0015,
    colorRgb: [0.64, 0.66, 0.7],
    roleSummary: '玄武质洋壳主要长石相，为海洋提供Ca²⁺沉积碳酸钙',
  },
  {
    id: 'Al2O3',
    formulaTag: 'Al₂O₃',
    nameZh: '刚玉/氧化铝',
    nameEn: 'Alumina / Corundum',
    domain: 'lithosphere',
    atoms: { Al: 2, O: 3 },
    standardPhase298K: 'solid',
    densityKgM3: 3987,
    specificHeatJPerMolK: 79.0,
    diffusivityM2s: 0.001,
    colorRgb: [0.78, 0.84, 0.92],
    roleSummary: '黏土风化残余高铝氧化物及耐火晶体相',
  },
  {
    id: 'P4O10',
    formulaTag: 'P₄O₁₀',
    nameZh: '磷酸盐矿物基元',
    nameEn: 'Phosphate Oxide',
    domain: 'lithosphere',
    atoms: { P: 4, O: 10 },
    standardPhase298K: 'solid',
    densityKgM3: 2390,
    specificHeatJPerMolK: 212.0,
    diffusivityM2s: 0.002,
    colorRgb: [0.92, 0.62, 0.28],
    roleSummary: '生物可利用磷限制性养分源头储备',
  },
  {
    id: 'NaCl',
    formulaTag: 'NaCl',
    nameZh: '岩盐 (氯化钠)',
    nameEn: 'Halite',
    domain: 'hydrosphere',
    atoms: { Na: 1, Cl: 1 },
    standardPhase298K: 'solid',
    densityKgM3: 2165,
    specificHeatJPerMolK: 50.5,
    diffusivityM2s: 0.036,
    colorRgb: [0.92, 0.94, 0.98],
    roleSummary: '海水蒸发岩盐分与细胞外渗压主要电解质',
  },
];

export const COMPOUND_CATALOG: ReadonlyArray<CompoundDef> = RAW_COMPOUNDS.map((c) => ({
  ...c,
  molarMassKgPerMol: computeCompoundMolarMassKgPerMol(c.atoms),
}));

const COMPOUND_MAP = new Map<string, CompoundDef>(
  COMPOUND_CATALOG.map((c) => [c.id, c]),
);

export function getCompoundById(id: string): CompoundDef | undefined {
  return COMPOUND_MAP.get(id);
}

export interface MaterialMineralFraction {
  readonly compoundId: string;
  readonly weightFraction: number; // sums to 1.0
  readonly roleNote: string;
}

export interface VoxelMaterialComposition {
  readonly materialId: MaterialId;
  readonly materialNameZh: string;
  readonly dominantFormulaTag: string;
  readonly bulkDensityKgM3: number;
  readonly effectivePorosity: number;
  readonly geochemistrySummary: string;
  readonly components: ReadonlyArray<MaterialMineralFraction>;
}

export const VOXEL_MATERIAL_COMPOSITIONS: Record<MaterialId, VoxelMaterialComposition> = {
  0: {
    materialId: 0 as MaterialId,
    materialNameZh: '大气孔隙空间',
    dominantFormulaTag: 'N₂ · O₂ · CO₂ · H₂O(g)',
    bulkDensityKgM3: 1.225,
    effectivePorosity: 1.0,
    geochemistrySummary: '开放对流大气层：氮气缓冲背景下进行水汽搬运与碳氧交换',
    components: [
      { compoundId: 'N2', weightFraction: 0.76, roleNote: '大气惰性氮压基准' },
      { compoundId: 'O2', weightFraction: 0.21, roleNote: '产氧光合富集氧库' },
      { compoundId: 'H2Og', weightFraction: 0.02, roleNote: '大气水循环潜热相' },
      { compoundId: 'CO2', weightFraction: 0.01, roleNote: '温室调节与光合碳源' },
    ],
  },
  1: {
    materialId: 1 as MaterialId,
    materialNameZh: '腐殖壤土层',
    dominantFormulaTag: 'SiO₂ · CH₂O · H₂O(l)',
    bulkDensityKgM3: 1580,
    effectivePorosity: 0.58,
    geochemistrySummary: '表生生物风化层：富含腐殖有机碳(CH₂O)、石英颗粒及孔隙微生物水膜',
    components: [
      { compoundId: 'SiO2', weightFraction: 0.52, roleNote: '硅质风化母质骨架' },
      { compoundId: 'Al2O3', weightFraction: 0.16, roleNote: '黏土铝硅酸盐矿物胶体' },
      { compoundId: 'CH2O', weightFraction: 0.14, roleNote: '生物腐殖质与活性有机碳' },
      { compoundId: 'H2Ol', weightFraction: 0.12, roleNote: '毛细孔隙液态水膜' },
      { compoundId: 'Fe2O3', weightFraction: 0.06, roleNote: '表层氧化铁着色组分' },
    ],
  },
  2: {
    materialId: 2 as MaterialId,
    materialNameZh: '花岗岩质硅铝壳',
    dominantFormulaTag: 'SiO₂ · KAlSi₃O₈ · CaCO₃',
    bulkDensityKgM3: 2680,
    effectivePorosity: 0.22,
    geochemistrySummary: '大陆花岗质上地壳：石英-钾长石骨架通过硅酸盐风化长期调节大气CO₂',
    components: [
      { compoundId: 'SiO2', weightFraction: 0.48, roleNote: '结晶石英骨架' },
      { compoundId: 'KAlSi3O8', weightFraction: 0.34, roleNote: '钾长石造岩主相' },
      { compoundId: 'CaAl2Si2O8', weightFraction: 0.12, roleNote: '斜长石风化钙源' },
      { compoundId: 'CaCO3', weightFraction: 0.06, roleNote: '裂隙次生方解石脉' },
    ],
  },
  3: {
    materialId: 3 as MaterialId,
    materialNameZh: '玄武岩质铁镁洋壳',
    dominantFormulaTag: 'Mg₂SiO₄ · CaAl₂Si₂O₈ · Fe₃O₄',
    bulkDensityKgM3: 2980,
    effectivePorosity: 0.24,
    geochemistrySummary: '深部及热泉基性玄武壳：橄榄石与铁硫矿物可驱动热液蛇纹石化产氢',
    components: [
      { compoundId: 'CaAl2Si2O8', weightFraction: 0.44, roleNote: '钙长石基质框架' },
      { compoundId: 'Mg2SiO4', weightFraction: 0.32, roleNote: '镁橄榄石地幔衍生相' },
      { compoundId: 'Fe3O4', weightFraction: 0.14, roleNote: '磁铁矿铁氧化相' },
      { compoundId: 'FeS2', weightFraction: 0.1, roleNote: '热液黄铁矿催化表面' },
    ],
  },
  4: {
    materialId: 4 as MaterialId,
    materialNameZh: '自生矿化晶簇',
    dominantFormulaTag: 'SiO₂ · CaCO₃ · P₄O₁₀',
    bulkDensityKgM3: 2740,
    effectivePorosity: 0.45,
    geochemistrySummary: '生物/热液自催化沉积体：高纯度方解石碳汇晶体与磷酸盐活性晶面',
    components: [
      { compoundId: 'CaCO3', weightFraction: 0.45, roleNote: '方解石碳酸盐碳汇晶簇' },
      { compoundId: 'SiO2', weightFraction: 0.38, roleNote: '热液脉石英骨架' },
      { compoundId: 'Al2O3', weightFraction: 0.1, roleNote: '刚玉族高强晶相' },
      { compoundId: 'P4O10', weightFraction: 0.07, roleNote: '磷灰石生物磷酸盐储备' },
    ],
  },
  5: {
    materialId: 5 as MaterialId,
    materialNameZh: '极地冰盖与水合物',
    dominantFormulaTag: 'H₂O(s) · CO₂ · CH₄',
    bulkDensityKgM3: 925,
    effectivePorosity: 0.45,
    geochemistrySummary: '低温冰冻圈：水冰晶格包裹少量溶解碳酸与甲烷气体水合物',
    components: [
      { compoundId: 'H2Os', weightFraction: 0.91, roleNote: '六方结晶水冰主相' },
      { compoundId: 'H2CO3', weightFraction: 0.05, roleNote: '封存碳酸冰雪组分' },
      { compoundId: 'CH4', weightFraction: 0.02, roleNote: '极地笼形甲烷水合物' },
      { compoundId: 'NaCl', weightFraction: 0.02, roleNote: '海冰析出微盐卤水囊' },
    ],
  },
  6: {
    materialId: 6 as MaterialId,
    materialNameZh: '多孔沉积砂岩',
    dominantFormulaTag: 'SiO₂ · CaCO₃ · Fe₂O₃',
    bulkDensityKgM3: 2380,
    effectivePorosity: 0.48,
    geochemistrySummary: '水成高孔隙沉积岩层：高渗透率利于地下水-微生物通量迁移与酸蚀溶解',
    components: [
      { compoundId: 'SiO2', weightFraction: 0.66, roleNote: '分选石英砂粒骨架' },
      { compoundId: 'CaCO3', weightFraction: 0.2, roleNote: '碳酸盐胶结物(易受乳酸酸蚀)' },
      { compoundId: 'Fe2O3', weightFraction: 0.08, roleNote: '赤铁矿胶结氧化层' },
      { compoundId: 'H2Ol', weightFraction: 0.06, roleNote: '孔隙承压含水层' },
    ],
  },
};

export interface ElementMassFractionItem {
  readonly symbol: string;
  readonly nameZh: string;
  readonly atomicNumber: number;
  readonly weightPercent: number;
  readonly cpkRgb: readonly [number, number, number];
}

/**
 * Computes exact elemental mass fractions (%) for any MaterialId from its mineral compounds
 * and the Periodic Table's atomic masses.
 */
export function computeMaterialElementalBreakdown(
  matId: MaterialId,
): ReadonlyArray<ElementMassFractionItem> {
  const comp = VOXEL_MATERIAL_COMPOSITIONS[matId] ?? VOXEL_MATERIAL_COMPOSITIONS[2 as MaterialId];
  const elementMassAccum = new Map<string, number>();

  for (const frac of comp.components) {
    const compound = COMPOUND_MAP.get(frac.compoundId);
    if (!compound) continue;
    const compMolarG = compound.molarMassKgPerMol * 1000;
    if (compMolarG <= 0) continue;

    for (const sym of Object.keys(compound.atoms)) {
      const count = compound.atoms[sym] ?? 0;
      const el = ELEMENT_BY_SYMBOL.get(sym);
      if (!el || count <= 0) continue;
      const elemFracInCompound = (el.atomicMassGPerMol * count) / compMolarG;
      const prev = elementMassAccum.get(sym) ?? 0;
      elementMassAccum.set(sym, prev + frac.weightFraction * elemFracInCompound);
    }
  }

  let total = 0;
  for (const v of elementMassAccum.values()) total += v;
  const norm = total > 0 ? 100 / total : 1;

  const list: ElementMassFractionItem[] = [];
  for (const [sym, mass] of elementMassAccum.entries()) {
    const el = ELEMENT_BY_SYMBOL.get(sym);
    if (!el) continue;
    list.push({
      symbol: sym,
      nameZh: el.nameZh,
      atomicNumber: el.atomicNumber,
      weightPercent: mass * norm,
      cpkRgb: el.cpkRgb,
    });
  }
  list.sort((a, b) => b.weightPercent - a.weightPercent);
  return list;
}
