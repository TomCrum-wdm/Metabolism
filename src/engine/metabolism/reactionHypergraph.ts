// Reaction Hypergraph Kernel for 《Metabolism》
// Architecture constraint:
// - Kernel operates strictly on integer Species indices and compiled numeric stoichiometric matrices.
// - Chemical formula strings (formulaTag, uiEquationLabel) are strictly UI labels and are NEVER parsed by simulation logic.

import { getCompoundById } from './periodicTable';

export const GAS_CONSTANT_R = 8.314462618; // J / (mol * K)

export type SpeciesRole =
  | 'substrate'
  | 'autocatalyst'
  | 'intermediate'
  | 'product'
  | 'waste';

export interface SpeciesDef {
  /** Integer species slot index (0 .. numSpecies - 1) used exclusively by the solver kernel */
  readonly index: number;
  readonly key: string;
  /** Optional link to Periodic Table compound catalog (used for UI & stoichiometric verification only) */
  readonly compoundId?: string;
  /** Optional elemental atom counts for strict atom conservation verification */
  readonly elementComposition?: Readonly<Record<string, number>>;
  /** Human-readable name for UI only */
  readonly uiLabel: string;
  /** Chemical formula tag for UI display only (never parsed by kernel) */
  readonly formulaTag: string;
  /** Molar mass in kg/mol used for strict mass conservation verification */
  readonly molarMassKgPerMol: number;
  /** Reference molecular diffusivity in m^2/s */
  readonly diffusivityM2s: number;
  /** Molar heat capacity at constant volume in J/(mol*K) */
  readonly specificHeatJPerMolK: number;
  /** Standard molar enthalpy in J/mol */
  readonly standardEnthalpyJPerMol: number;
  /** Read-only visualization RGB color [0..1] */
  readonly colorRgb: readonly [number, number, number];
  readonly role: SpeciesRole;
}

export interface StoichTerm {
  /** Integer index into CompiledReactionHypergraph.species */
  readonly speciesIndex: number;
  /** Stoichiometric coefficient (> 0) */
  readonly stoich: number;
  /** Optional kinetic reaction order (defaults to stoich) */
  readonly order?: number;
}

export interface ReactionDef {
  readonly id: string;
  /** UI display name only */
  readonly uiName: string;
  /** UI equation label only (never parsed by kernel) */
  readonly uiEquationLabel: string;
  readonly reactants: ReadonlyArray<StoichTerm>;
  readonly products: ReadonlyArray<StoichTerm>;
  /** Forward Arrhenius pre-exponential factor (units match rate order) */
  readonly forwardA: number;
  /** Forward activation energy Ea in J/mol */
  readonly forwardEaJ: number;
  /** Modified Arrhenius temperature exponent beta: (T / 298.15)^beta */
  readonly tempExponentBeta?: number;
  readonly isReversible: boolean;
  /** Reverse Arrhenius pre-exponential factor */
  readonly reverseA?: number;
  /** Reverse activation energy Ea in J/mol */
  readonly reverseEaJ?: number;
  /** Reaction enthalpy deltaH in J/mol-reaction (<0 exothermic, >0 endothermic) */
  readonly enthalpyChangeJ: number;
  /** Thermodynamic T/P validity window [minTempK, maxTempK] x [minPressureAtm, maxPressureAtm] */
  readonly minTempK: number;
  readonly maxTempK: number;
  readonly minPressureAtm: number;
  readonly maxPressureAtm: number;
}

export interface CompiledReactionHypergraph {
  readonly id: string;
  readonly uiTitle: string;
  readonly species: ReadonlyArray<SpeciesDef>;
  readonly reactions: ReadonlyArray<ReactionDef>;
  readonly numSpecies: number;
  readonly numReactions: number;
  /** Row-major [numReactions x numSpecies]: nu_{r,s} = nu_prod - nu_react */
  readonly stoichMatrix: Float64Array;
  /** Row-major [numReactions x numSpecies]: forward kinetic order alpha_{r,s} */
  readonly reactantOrderMatrix: Float64Array;
  /** Row-major [numReactions x numSpecies]: reverse kinetic order beta_{r,s} */
  readonly productOrderMatrix: Float64Array;
  readonly molarMasses: Float64Array;
  readonly diffusivities: Float64Array;
  /** Per-reaction stoichiometric mass balance residual sum_s(nu_{r,s} * M_s) in kg/mol */
  readonly stoichMassResiduals: Float64Array;
  readonly isStoichMassConserved: boolean;
  /** Runtime calibration overrides (populated ONLY via coarse-graining PIC hooks) */
  readonly calibratedForwardA: Float64Array;
  readonly calibratedForwardEaJ: Float64Array;
  readonly calibratedDiffusivityScale: Float64Array;
}

export interface CellReactionStepResult {
  /** Reaction enthalpy change applied to internal energy (J/m^3) */
  deltaInternalEnergyJm3: number;
  /** Non-negative local entropy production rate (J/(m^3*K*s)) */
  entropyProductionRate: number;
  /** Number of reactions currently active inside T/P validity window */
  activeReactionCount: number;
  /** Sum of absolute species turnover rates (mol/(m^3*s)) */
  totalTurnoverRate: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Compiles species and reactions into dense numeric stoichiometric and kinetic matrices.
 * Zero string parsing of chemical formulas occurs here.
 */
export function compileReactionHypergraph(
  id: string,
  uiTitle: string,
  species: ReadonlyArray<SpeciesDef>,
  reactions: ReadonlyArray<ReactionDef>,
): CompiledReactionHypergraph {
  const numSpecies = species.length;
  const numReactions = reactions.length;

  for (let s = 0; s < numSpecies; s++) {
    if (species[s].index !== s) {
      throw new Error(`Species index mismatch at slot ${s}: got ${species[s].index}`);
    }
    if (!(species[s].molarMassKgPerMol > 0)) {
      throw new Error(`Species ${s} molarMassKgPerMol must be positive`);
    }
  }

  const stoichMatrix = new Float64Array(numReactions * numSpecies);
  const reactantOrderMatrix = new Float64Array(numReactions * numSpecies);
  const productOrderMatrix = new Float64Array(numReactions * numSpecies);
  const molarMasses = new Float64Array(numSpecies);
  const diffusivities = new Float64Array(numSpecies);
  const calibratedDiffusivityScale = new Float64Array(numSpecies).fill(1.0);

  for (let s = 0; s < numSpecies; s++) {
    molarMasses[s] = species[s].molarMassKgPerMol;
    diffusivities[s] = species[s].diffusivityM2s;
  }

  const stoichMassResiduals = new Float64Array(numReactions);
  const calibratedForwardA = new Float64Array(numReactions);
  const calibratedForwardEaJ = new Float64Array(numReactions);
  let isStoichMassConserved = true;

  for (let r = 0; r < numReactions; r++) {
    const rxn = reactions[r];
    const rowOff = r * numSpecies;
    calibratedForwardA[r] = rxn.forwardA;
    calibratedForwardEaJ[r] = rxn.forwardEaJ;

    for (let i = 0; i < rxn.reactants.length; i++) {
      const term = rxn.reactants[i];
      if (term.speciesIndex < 0 || term.speciesIndex >= numSpecies) {
        throw new Error(`Reaction ${rxn.id} reactant speciesIndex ${term.speciesIndex} out of bounds`);
      }
      stoichMatrix[rowOff + term.speciesIndex] -= term.stoich;
      reactantOrderMatrix[rowOff + term.speciesIndex] += term.order ?? term.stoich;
    }

    for (let i = 0; i < rxn.products.length; i++) {
      const term = rxn.products[i];
      if (term.speciesIndex < 0 || term.speciesIndex >= numSpecies) {
        throw new Error(`Reaction ${rxn.id} product speciesIndex ${term.speciesIndex} out of bounds`);
      }
      stoichMatrix[rowOff + term.speciesIndex] += term.stoich;
      productOrderMatrix[rowOff + term.speciesIndex] += term.order ?? term.stoich;
    }

    let massResidual = 0;
    for (let s = 0; s < numSpecies; s++) {
      massResidual += stoichMatrix[rowOff + s] * molarMasses[s];
    }
    stoichMassResiduals[r] = massResidual;
    if (Math.abs(massResidual) > 1e-12) {
      isStoichMassConserved = false;
    }
  }

  return {
    id,
    uiTitle,
    species,
    reactions,
    numSpecies,
    numReactions,
    stoichMatrix,
    reactantOrderMatrix,
    productOrderMatrix,
    molarMasses,
    diffusivities,
    stoichMassResiduals,
    isStoichMassConserved,
    calibratedForwardA,
    calibratedForwardEaJ,
    calibratedDiffusivityScale,
  };
}

/**
 * Evaluates thermodynamic T/P validity window gate in [0, 1].
 * Returns 0 outside [minTempK, maxTempK] x [minPressureAtm, maxPressureAtm],
 * with a gentle 3% boundary taper so transitions remain smooth.
 */
export function evaluateTpWindowGate(
  rxn: ReactionDef,
  tempK: number,
  pressureAtm: number,
): number {
  if (
    tempK < rxn.minTempK ||
    tempK > rxn.maxTempK ||
    pressureAtm < rxn.minPressureAtm ||
    pressureAtm > rxn.maxPressureAtm
  ) {
    return 0;
  }
  const tSpan = Math.max(1e-3, rxn.maxTempK - rxn.minTempK);
  const tPad = Math.max(1e-3, Math.min(tSpan * 0.03, 12.0));
  const pSpan = Math.max(1e-4, rxn.maxPressureAtm - rxn.minPressureAtm);
  const pPad = Math.max(1e-4, Math.min(pSpan * 0.03, Math.max(0.02, rxn.minPressureAtm * 0.5)));

  const tLo = clamp((tempK - rxn.minTempK) / tPad, 0, 1);
  const tHi = clamp((rxn.maxTempK - tempK) / tPad, 0, 1);
  const pLo = clamp((pressureAtm - rxn.minPressureAtm) / pPad, 0, 1);
  const pHi = clamp((rxn.maxPressureAtm - pressureAtm) / pPad, 0, 1);
  return Math.min(tLo, tHi, pLo, pHi);
}

/**
 * Evaluates modified Arrhenius rate constant:
 * k(T) = A * (T / 298.15)^beta * exp(-Ea / (R * T))
 */
export function evaluateArrheniusRateConstant(
  preExpA: number,
  activationEnergyJ: number,
  tempExponentBeta: number,
  tempK: number,
): number {
  const safeT = Math.max(20, tempK);
  const betaFactor =
    tempExponentBeta !== 0 ? Math.pow(safeT / 298.15, tempExponentBeta) : 1.0;
  const expArg = clamp(-activationEnergyJ / (GAS_CONSTANT_R * safeT), -70, 20);
  return preExpA * betaFactor * Math.exp(expArg);
}

// Reusable scratch buffers for zero-GC cell integration
const MAX_LOCAL_SPECIES = 16;
const MAX_LOCAL_REACTIONS = 32;
const _scratchRates = new Float64Array(MAX_LOCAL_REACTIONS);
const _scratchDeltaC = new Float64Array(MAX_LOCAL_SPECIES);
const _scratchLocalC = new Float64Array(MAX_LOCAL_SPECIES);

/**
 * Integrates the reaction hypergraph inside a SINGLE Eulerian control volume (local reaction operator).
 * Purely local (zero spatial neighbor reads), positivity-preserving, and strictly stoichiometric-mass-conserving.
 */
export function integrateCellReactions(
  hypergraph: CompiledReactionHypergraph,
  concArray: Float32Array,
  concOffset: number,
  tempK: number,
  pressureAtm: number,
  dtSec: number,
  outResult: CellReactionStepResult,
  rateMultiplier = 1.0,
  /** Optional caller-supplied buffer [numReactions] receiving first-substep net reaction rates mol/(m^3*s) */
  reactionRatesOut?: Float64Array,
): void {
  const S = hypergraph.numSpecies;
  const R = hypergraph.numReactions;

  outResult.deltaInternalEnergyJm3 = 0;
  outResult.entropyProductionRate = 0;
  outResult.activeReactionCount = 0;
  outResult.totalTurnoverRate = 0;
  if (reactionRatesOut) {
    for (let r = 0; r < R; r++) reactionRatesOut[r] = 0;
  }

  if (dtSec <= 0 || S === 0 || R === 0) return;

  for (let s = 0; s < S; s++) {
    _scratchLocalC[s] = Math.max(0, concArray[concOffset + s]);
  }

  // Adaptive positivity-preserving substepping (max 8 substeps)
  let remainingDt = dtSec;
  let substeps = 0;
  const safeTempK = Math.max(20, tempK);

  while (remainingDt > 1e-12 && substeps < 8) {
    substeps++;
    _scratchDeltaC.fill(0);
    let activeRxnsThisSubstep = 0;
    let totalTurnover = 0;
    let entropyProd = 0;
    let dHRate = 0;

    for (let r = 0; r < R; r++) {
      const rxn = hypergraph.reactions[r];
      const gate = evaluateTpWindowGate(rxn, safeTempK, pressureAtm);
      if (gate <= 0) {
        _scratchRates[r] = 0;
        continue;
      }
      activeRxnsThisSubstep++;

      const rowOff = r * S;
      const kf =
        evaluateArrheniusRateConstant(
          hypergraph.calibratedForwardA[r],
          hypergraph.calibratedForwardEaJ[r],
          rxn.tempExponentBeta ?? 0,
          safeTempK,
        ) *
        gate *
        rateMultiplier;

      let fwdProd = 1.0;
      for (let s = 0; s < S; s++) {
        const ord = hypergraph.reactantOrderMatrix[rowOff + s];
        if (ord > 0) {
          const c = _scratchLocalC[s];
          if (c <= 0) {
            fwdProd = 0;
            break;
          }
          fwdProd *= ord === 1 ? c : ord === 2 ? c * c : Math.pow(c, ord);
        }
      }
      const fwdRate = kf * fwdProd;

      let revRate = 0;
      if (rxn.isReversible && (rxn.reverseA ?? 0) > 0) {
        const kr =
          evaluateArrheniusRateConstant(
            rxn.reverseA ?? 0,
            rxn.reverseEaJ ?? rxn.forwardEaJ,
            rxn.tempExponentBeta ?? 0,
            safeTempK,
          ) *
          gate *
          rateMultiplier;

        let revProd = 1.0;
        for (let s = 0; s < S; s++) {
          const ord = hypergraph.productOrderMatrix[rowOff + s];
          if (ord > 0) {
            const c = _scratchLocalC[s];
            if (c <= 0) {
              revProd = 0;
              break;
            }
            revProd *= ord === 1 ? c : ord === 2 ? c * c : Math.pow(c, ord);
          }
        }
        revRate = kr * revProd;
      }

      const netRate = fwdRate - revRate;
      _scratchRates[r] = netRate;
      totalTurnover += Math.abs(netRate);
      dHRate += netRate * rxn.enthalpyChangeJ;

      // De Donder affinity entropy production sigma = R * (J_f - J_r) * ln(J_f / J_r) >= 0
      if (fwdRate > 1e-15 && revRate > 1e-15) {
        entropyProd += GAS_CONSTANT_R * (fwdRate - revRate) * Math.log(fwdRate / revRate);
      } else if (Math.abs(netRate) > 1e-15) {
        // Driven irreversible reaction dissipates chemical free energy proportional to |netRate|
        entropyProd += GAS_CONSTANT_R * Math.abs(netRate) * 4.5;
      }

      for (let s = 0; s < S; s++) {
        const nu = hypergraph.stoichMatrix[rowOff + s];
        if (nu !== 0) {
          _scratchDeltaC[s] += nu * netRate;
        }
      }
    }

    if (substeps === 1) {
      outResult.activeReactionCount = activeRxnsThisSubstep;
      outResult.totalTurnoverRate = totalTurnover;
      outResult.entropyProductionRate = entropyProd;
      if (reactionRatesOut) {
        for (let r = 0; r < R; r++) {
          reactionRatesOut[r] = _scratchRates[r];
        }
      }
    }

    // Determine largest safe step factor <= 1.0 that keeps all species >= 0
    let stepDt = remainingDt;
    for (let s = 0; s < S; s++) {
      const rate = _scratchDeltaC[s];
      if (rate < -1e-15) {
        const maxDt = (_scratchLocalC[s] * 0.92) / -rate;
        if (maxDt < stepDt) {
          stepDt = Math.max(maxDt, remainingDt * 0.02);
        }
      }
    }

    // Clamp reaction extent proportionally if any species would go negative
    let scale = 1.0;
    for (let s = 0; s < S; s++) {
      const delta = _scratchDeltaC[s] * stepDt;
      if (_scratchLocalC[s] + delta < 0 && delta < -1e-18) {
        const allowed = Math.max(0, _scratchLocalC[s] / -delta);
        if (allowed < scale) scale = allowed;
      }
    }

    const effDt = stepDt * scale;
    for (let s = 0; s < S; s++) {
      _scratchLocalC[s] = Math.max(0, _scratchLocalC[s] + _scratchDeltaC[s] * effDt);
    }
    // Exothermic reaction (deltaH < 0) increases internal energy (or thermal pool)
    outResult.deltaInternalEnergyJm3 += -dHRate * effDt;

    remainingDt -= stepDt;
    if (scale < 1e-4) break;
  }

  for (let s = 0; s < S; s++) {
    concArray[concOffset + s] = _scratchLocalC[s];
  }
}

/**
 * Closed-System Equilibrium Demo Hypergraph:
 * Reversible isomerization A <-> B <-> C + slow direct A <-> C.
 * Equal molar mass (0.060 kg/mol) ensures exact stoichiometric mass conservation.
 */
export function createClosedEquilibriumHypergraph(): CompiledReactionHypergraph {
  const species: SpeciesDef[] = [
    {
      index: 0,
      key: 'species_a',
      uiLabel: '高能态组分 A',
      formulaTag: 'A',
      molarMassKgPerMol: 0.06,
      diffusivityM2s: 0.085,
      specificHeatJPerMolK: 42.0,
      standardEnthalpyJPerMol: 24000,
      colorRgb: [0.96, 0.45, 0.18], // Thermal amber-orange
      role: 'substrate',
    },
    {
      index: 1,
      key: 'species_b',
      uiLabel: '中间态组分 B',
      formulaTag: 'B',
      molarMassKgPerMol: 0.06,
      diffusivityM2s: 0.075,
      specificHeatJPerMolK: 42.0,
      standardEnthalpyJPerMol: 12000,
      colorRgb: [0.16, 0.82, 0.88], // Cyan
      role: 'intermediate',
    },
    {
      index: 2,
      key: 'species_c',
      uiLabel: '平衡基态组分 C',
      formulaTag: 'C',
      molarMassKgPerMol: 0.06,
      diffusivityM2s: 0.065,
      specificHeatJPerMolK: 42.0,
      standardEnthalpyJPerMol: 0,
      colorRgb: [0.24, 0.84, 0.48], // Emerald
      role: 'product',
    },
  ];

  const reactions: ReactionDef[] = [
    {
      id: 'rxn_ab',
      uiName: 'A/B 可逆异构化',
      uiEquationLabel: 'A ⇌ B',
      reactants: [{ speciesIndex: 0, stoich: 1 }],
      products: [{ speciesIndex: 1, stoich: 1 }],
      forwardA: 4.5,
      forwardEaJ: 4200,
      tempExponentBeta: 0,
      isReversible: true,
      reverseA: 2.2,
      reverseEaJ: 4600,
      enthalpyChangeJ: -1200,
      minTempK: 180,
      maxTempK: 1400,
      minPressureAtm: 0.01,
      maxPressureAtm: 500,
    },
    {
      id: 'rxn_bc',
      uiName: 'B/C 可逆弛豫',
      uiEquationLabel: 'B ⇌ C',
      reactants: [{ speciesIndex: 1, stoich: 1 }],
      products: [{ speciesIndex: 2, stoich: 1 }],
      forwardA: 3.4,
      forwardEaJ: 4500,
      tempExponentBeta: 0,
      isReversible: true,
      reverseA: 1.4,
      reverseEaJ: 5200,
      enthalpyChangeJ: -1000,
      minTempK: 180,
      maxTempK: 1400,
      minPressureAtm: 0.01,
      maxPressureAtm: 500,
    },
    {
      id: 'rxn_ac',
      uiName: 'A/C 直接旁路',
      uiEquationLabel: 'A ⇌ C',
      reactants: [{ speciesIndex: 0, stoich: 1 }],
      products: [{ speciesIndex: 2, stoich: 1 }],
      // Exact Wegscheider detailed balance: K_ac = K_ab * K_bc -> (1.0 / revA) = (4.5/2.2)*(3.4/1.4)
      forwardA: 1.0,
      forwardEaJ: 5500,
      tempExponentBeta: 0,
      isReversible: true,
      reverseA: (2.2 * 1.4) / (4.5 * 3.4),
      reverseEaJ: 6600,
      enthalpyChangeJ: -2200,
      minTempK: 230,
      maxTempK: 1400,
      minPressureAtm: 0.01,
      maxPressureAtm: 500,
    },
  ];

  return compileReactionHypergraph(
    'closed_equilibrium',
    '封闭可逆平衡超图 (A ⇌ B ⇌ C)',
    species,
    reactions,
  );
}

/**
 * Open Dissipative Autocatalytic Hypergraph:
 * Conserved-mass Gray-Scott / Sel'kov cubic autocatalysis:
 *   R0: S + 2X -> 3X   (autocatalytic positive feedback inside active T/P window)
 *   R1: X -> W         (dissipation / decay to waste W)
 *   R2: S <-> X        (tiny background nucleation)
 *
 * Equal molar mass (0.050 kg/mol) guarantees exact stoichiometric mass conservation.
 */
export function createOpenAutocatalyticHypergraph(): CompiledReactionHypergraph {
  const species: SpeciesDef[] = [
    {
      index: 0,
      key: 'substrate_s',
      uiLabel: '高势进料底物 S',
      formulaTag: 'S',
      molarMassKgPerMol: 0.05,
      diffusivityM2s: 0.14, // Substrate diffuses faster than autocatalyst (Turing ratio > 2)
      specificHeatJPerMolK: 38.0,
      standardEnthalpyJPerMol: 32000,
      colorRgb: [0.22, 0.56, 0.96], // Cobalt-blue feed
      role: 'substrate',
    },
    {
      index: 1,
      key: 'autocatalyst_x',
      uiLabel: '自催化活性体 X',
      formulaTag: 'X',
      molarMassKgPerMol: 0.05,
      diffusivityM2s: 0.045, // Slower activator forms localized dissipative structures
      specificHeatJPerMolK: 48.0,
      standardEnthalpyJPerMol: 18000,
      colorRgb: [0.96, 0.28, 0.52], // Vivid magenta-crimson autocatalytic pattern
      role: 'autocatalyst',
    },
    {
      index: 2,
      key: 'waste_w',
      uiLabel: '耗散代谢废物 W',
      formulaTag: 'W',
      molarMassKgPerMol: 0.05,
      diffusivityM2s: 0.16,
      specificHeatJPerMolK: 34.0,
      standardEnthalpyJPerMol: 0,
      colorRgb: [0.38, 0.44, 0.54], // Muted slate exhaust
      role: 'waste',
    },
  ];

  const reactions: ReactionDef[] = [
    {
      id: 'rxn_autocat',
      uiName: '三次自催化正反馈',
      uiEquationLabel: 'S + 2X → 3X',
      reactants: [
        { speciesIndex: 0, stoich: 1, order: 1 },
        { speciesIndex: 1, stoich: 2, order: 2 },
      ],
      products: [{ speciesIndex: 1, stoich: 3 }],
      forwardA: 3.8,
      forwardEaJ: 2400,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: -1800,
      minTempK: 250,
      maxTempK: 680,
      minPressureAtm: 0.05,
      maxPressureAtm: 250,
    },
    {
      id: 'rxn_decay',
      uiName: '活性体耗散失活',
      uiEquationLabel: 'X → W',
      reactants: [{ speciesIndex: 1, stoich: 1 }],
      products: [{ speciesIndex: 2, stoich: 1 }],
      forwardA: 0.52,
      forwardEaJ: 1800,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: -900,
      minTempK: 180,
      maxTempK: 1400,
      minPressureAtm: 0.01,
      maxPressureAtm: 500,
    },
    {
      id: 'rxn_nucleate',
      uiName: '热力学微量自发成核',
      uiEquationLabel: 'S ⇌ X',
      reactants: [{ speciesIndex: 0, stoich: 1 }],
      products: [{ speciesIndex: 1, stoich: 1 }],
      forwardA: 0.008,
      forwardEaJ: 4200,
      tempExponentBeta: 0,
      isReversible: true,
      reverseA: 0.004,
      reverseEaJ: 4600,
      enthalpyChangeJ: -400,
      minTempK: 250,
      maxTempK: 750,
      minPressureAtm: 0.05,
      maxPressureAtm: 250,
    },
  ];

  return compileReactionHypergraph(
    'open_autocatalytic',
    '开放自催化耗散超图 (S + 2X → 3X, X → W)',
    species,
    reactions,
  );
}

export interface ElementConservationAudit {
  readonly isElementBalanced: boolean;
  readonly perReactionAtomResiduals: ReadonlyArray<Readonly<Record<string, number>>>;
}

/**
 * Verifies element-by-element atomic stoichiometry conservation across all reactions
 * for hypergraphs whose species carry elemental composition vectors.
 */
export function verifyHypergraphElementBalance(
  hypergraph: CompiledReactionHypergraph,
): ElementConservationAudit {
  const S = hypergraph.numSpecies;
  const R = hypergraph.numReactions;
  const perReactionAtomResiduals: Array<Record<string, number>> = [];
  let isElementBalanced = true;

  for (let r = 0; r < R; r++) {
    const residuals: Record<string, number> = {};
    const rowOff = r * S;
    for (let s = 0; s < S; s++) {
      const nu = hypergraph.stoichMatrix[rowOff + s];
      if (nu === 0) continue;
      const atoms =
        hypergraph.species[s].elementComposition ??
        (hypergraph.species[s].compoundId
          ? getCompoundById(hypergraph.species[s].compoundId!)?.atoms
          : undefined);
      if (!atoms) continue;
      for (const sym of Object.keys(atoms)) {
        residuals[sym] = (residuals[sym] ?? 0) + nu * (atoms[sym] ?? 0);
      }
    }
    for (const sym of Object.keys(residuals)) {
      if (Math.abs(residuals[sym]) > 1e-9) {
        isElementBalanced = false;
      }
    }
    perReactionAtomResiduals.push(residuals);
  }

  return { isElementBalanced, perReactionAtomResiduals };
}

function makeSpeciesFromCompound(
  index: number,
  key: string,
  compoundId: string,
  role: SpeciesRole,
  overrides?: Partial<Pick<SpeciesDef, 'uiLabel' | 'formulaTag' | 'diffusivityM2s' | 'colorRgb'>>,
): SpeciesDef {
  const c = getCompoundById(compoundId);
  if (!c) throw new Error(`Missing compound '${compoundId}' in catalog`);
  return {
    index,
    key,
    compoundId,
    elementComposition: c.atoms,
    uiLabel: overrides?.uiLabel ?? c.nameZh,
    formulaTag: overrides?.formulaTag ?? c.formulaTag,
    molarMassKgPerMol: c.molarMassKgPerMol,
    diffusivityM2s: overrides?.diffusivityM2s ?? c.diffusivityM2s,
    specificHeatJPerMolK: c.specificHeatJPerMolK,
    standardEnthalpyJPerMol: 0,
    colorRgb: overrides?.colorRgb ?? c.colorRgb,
    role,
  };
}

/**
 * Planetary Carbon & Water Cycle Hypergraph (6 Species, 5 Balanced Reactions):
 *   S0: CO₂       (大气温室与固碳碳源)
 *   S1: H₂O(g)    (水蒸气潜热气相)
 *   S2: H₂O(l)    (液态海洋/土壤水)
 *   S3: CH₂O      (光合有机生物质)
 *   S4: O₂        (光合分子氧)
 *   S5: CH₄       (厌氧产甲烷)
 */
export function createPlanetaryCarbonWaterHypergraph(): CompiledReactionHypergraph {
  const species: SpeciesDef[] = [
    makeSpeciesFromCompound(0, 'co2', 'CO2', 'substrate', { diffusivityM2s: 0.14 }),
    makeSpeciesFromCompound(1, 'h2o_g', 'H2Og', 'intermediate', { diffusivityM2s: 0.18 }),
    makeSpeciesFromCompound(2, 'h2o_l', 'H2Ol', 'substrate', { diffusivityM2s: 0.065 }),
    makeSpeciesFromCompound(3, 'biomass_ch2o', 'CH2O', 'autocatalyst', {
      uiLabel: '有机生物质',
      diffusivityM2s: 0.025,
    }),
    makeSpeciesFromCompound(4, 'o2', 'O2', 'product', { diffusivityM2s: 0.16 }),
    makeSpeciesFromCompound(5, 'ch4', 'CH4', 'waste', { diffusivityM2s: 0.17 }),
  ];

  const reactions: ReactionDef[] = [
    {
      id: 'rxn_water_phase',
      uiName: '海洋蒸发 / 高空凝结',
      uiEquationLabel: 'H₂O(l) ⇌ H₂O(g)',
      reactants: [{ speciesIndex: 2, stoich: 1, order: 1 }],
      products: [{ speciesIndex: 1, stoich: 1, order: 1 }],
      forwardA: 3.6,
      forwardEaJ: 5400,
      tempExponentBeta: 0,
      isReversible: true,
      reverseA: 0.18,
      reverseEaJ: 1200,
      enthalpyChangeJ: 1850, // Evaporation absorbs heat (+ΔH), condensation releases heat
      minTempK: 210,
      maxTempK: 1300,
      minPressureAtm: 0.01,
      maxPressureAtm: 400,
    },
    {
      id: 'rxn_photosynthesis',
      uiName: '产氧光合固碳',
      uiEquationLabel: 'CO₂ + H₂O(l) → CH₂O + O₂',
      reactants: [
        { speciesIndex: 0, stoich: 1, order: 1 },
        { speciesIndex: 2, stoich: 1, order: 1 },
      ],
      products: [
        { speciesIndex: 3, stoich: 1 },
        { speciesIndex: 4, stoich: 1 },
      ],
      forwardA: 1.45,
      forwardEaJ: 2900,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: 1900, // Endothermic solar photon storage
      minTempK: 265,
      maxTempK: 390,
      minPressureAtm: 0.05,
      maxPressureAtm: 120,
    },
    {
      id: 'rxn_respiration',
      uiName: '有氧生物呼吸矿化',
      uiEquationLabel: 'CH₂O + O₂ → CO₂ + H₂O(l)',
      reactants: [
        { speciesIndex: 3, stoich: 1, order: 1 },
        { speciesIndex: 4, stoich: 1, order: 1 },
      ],
      products: [
        { speciesIndex: 0, stoich: 1 },
        { speciesIndex: 2, stoich: 1 },
      ],
      forwardA: 1.8,
      forwardEaJ: 2600,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: -2400, // Exothermic metabolic heat
      minTempK: 245,
      maxTempK: 520,
      minPressureAtm: 0.02,
      maxPressureAtm: 200,
    },
    {
      id: 'rxn_methanogenesis',
      uiName: '厌氧热泉产甲烷',
      uiEquationLabel: '2 CH₂O → CH₄ + CO₂',
      reactants: [{ speciesIndex: 3, stoich: 2, order: 2 }],
      products: [
        { speciesIndex: 5, stoich: 1 },
        { speciesIndex: 0, stoich: 1 },
      ],
      forwardA: 0.55,
      forwardEaJ: 3400,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: -950,
      minTempK: 270,
      maxTempK: 750,
      minPressureAtm: 0.05,
      maxPressureAtm: 400,
    },
    {
      id: 'rxn_ch4_oxidation',
      uiName: '大气甲烷氧化清除',
      uiEquationLabel: 'CH₄ + 2 O₂ → CO₂ + 2 H₂O(g)',
      reactants: [
        { speciesIndex: 5, stoich: 1, order: 1 },
        { speciesIndex: 4, stoich: 2, order: 1 },
      ],
      products: [
        { speciesIndex: 0, stoich: 1 },
        { speciesIndex: 1, stoich: 2 },
      ],
      forwardA: 1.9,
      forwardEaJ: 3200,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: -2900,
      minTempK: 250,
      maxTempK: 1200,
      minPressureAtm: 0.01,
      maxPressureAtm: 400,
    },
  ];

  return compileReactionHypergraph(
    'planetary_carbon_water',
    '星球碳循环与水循环超图 (CO₂ / H₂O / CH₂O / O₂ / CH₄)',
    species,
    reactions,
  );
}

/**
 * Cellular Bioenergetic Metabolism Hypergraph (6 Species, 5 Balanced Reactions):
 *   S0: C₆H₁₂O₆  (葡萄糖底物)
 *   S1: O₂        (呼吸分子氧)
 *   S2: CO₂       (代谢二氧化碳)
 *   S3: H₂O(l)    (胞内水溶剂)
 *   S4: C₃H₆O₃    (无氧糖酵解乳酸)
 *   S5: CH₂O      (生物膜/细胞质同化生物质)
 * Effective kinetic order = 1 avoids numerical stiffness while stoich enforces exact atom balance.
 */
export function createCellularMetabolismHypergraph(): CompiledReactionHypergraph {
  const species: SpeciesDef[] = [
    makeSpeciesFromCompound(0, 'glucose', 'C6H12O6', 'substrate', { diffusivityM2s: 0.045 }),
    makeSpeciesFromCompound(1, 'o2', 'O2', 'substrate', { diffusivityM2s: 0.16 }),
    makeSpeciesFromCompound(2, 'co2', 'CO2', 'waste', { diffusivityM2s: 0.14 }),
    makeSpeciesFromCompound(3, 'h2o', 'H2Ol', 'intermediate', {
      uiLabel: '胞内介质水',
      formulaTag: 'H₂O',
      diffusivityM2s: 0.08,
    }),
    makeSpeciesFromCompound(4, 'lactate', 'C3H6O3', 'waste', { diffusivityM2s: 0.055 }),
    makeSpeciesFromCompound(5, 'biomass', 'CH2O', 'autocatalyst', {
      uiLabel: '原生质生物量',
      formulaTag: 'CH₂O(生物质)',
      diffusivityM2s: 0.02,
    }),
  ];

  const reactions: ReactionDef[] = [
    {
      id: 'cell_photosynth_gluconeogenesis',
      uiName: '自养固碳合成葡萄糖',
      uiEquationLabel: '6 CO₂ + 6 H₂O → C₆H₁₂O₆ + 6 O₂',
      reactants: [
        { speciesIndex: 2, stoich: 6, order: 1 },
        { speciesIndex: 3, stoich: 6, order: 1 },
      ],
      products: [
        { speciesIndex: 0, stoich: 1 },
        { speciesIndex: 1, stoich: 6 },
      ],
      forwardA: 0.24,
      forwardEaJ: 3100,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: 2400,
      minTempK: 268,
      maxTempK: 365,
      minPressureAtm: 0.05,
      maxPressureAtm: 150,
    },
    {
      id: 'cell_aerobic_respiration',
      uiName: '线粒体有氧 TCA 呼吸 (~30 ATP)',
      uiEquationLabel: 'C₆H₁₂O₆ + 6 O₂ → 6 CO₂ + 6 H₂O',
      reactants: [
        { speciesIndex: 0, stoich: 1, order: 1 },
        { speciesIndex: 1, stoich: 6, order: 1 },
      ],
      products: [
        { speciesIndex: 2, stoich: 6 },
        { speciesIndex: 3, stoich: 6 },
      ],
      forwardA: 0.85,
      forwardEaJ: 2200,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: -3200,
      minTempK: 265,
      maxTempK: 390,
      minPressureAtm: 0.02,
      maxPressureAtm: 200,
    },
    {
      id: 'cell_anaerobic_glycolysis',
      uiName: '胞质无氧糖酵解产乳酸 (2 ATP)',
      uiEquationLabel: 'C₆H₁₂O₆ → 2 C₃H₆O₃',
      reactants: [{ speciesIndex: 0, stoich: 1, order: 1 }],
      products: [{ speciesIndex: 4, stoich: 2 }],
      forwardA: 0.42,
      forwardEaJ: 2600,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: -1100,
      minTempK: 255,
      maxTempK: 420,
      minPressureAtm: 0.01,
      maxPressureAtm: 300,
    },
    {
      id: 'cell_lactate_recovery',
      uiName: '乳酸有氧重氧化 (Cori 循环)',
      uiEquationLabel: 'C₃H₆O₃ + 3 O₂ → 3 CO₂ + 3 H₂O',
      reactants: [
        { speciesIndex: 4, stoich: 1, order: 1 },
        { speciesIndex: 1, stoich: 3, order: 1 },
      ],
      products: [
        { speciesIndex: 2, stoich: 3 },
        { speciesIndex: 3, stoich: 3 },
      ],
      forwardA: 0.58,
      forwardEaJ: 2400,
      tempExponentBeta: 0,
      isReversible: false,
      enthalpyChangeJ: -1800,
      minTempK: 265,
      maxTempK: 395,
      minPressureAtm: 0.02,
      maxPressureAtm: 200,
    },
    {
      id: 'cell_biomass_assimilation',
      uiName: '生物质同化与膜修复',
      uiEquationLabel: 'C₆H₁₂O₆ ⇌ 6 CH₂O',
      reactants: [{ speciesIndex: 0, stoich: 1, order: 1 }],
      products: [{ speciesIndex: 5, stoich: 6, order: 1 }],
      forwardA: 0.35,
      forwardEaJ: 2100,
      tempExponentBeta: 0,
      isReversible: true,
      reverseA: 0.06,
      reverseEaJ: 2700,
      enthalpyChangeJ: -600,
      minTempK: 260,
      maxTempK: 395,
      minPressureAtm: 0.01,
      maxPressureAtm: 250,
    },
  ];

  return compileReactionHypergraph(
    'cellular_metabolism',
    '原生细胞生物能代谢超图 (葡萄糖 / 有氧呼吸 / 糖酵解 / 生物质)',
    species,
    reactions,
  );
}

/**
 * Planetary Three-Phase Water Cycle Hypergraph (3 Species, 3 Balanced Reactions):
 *   S0: H₂O(l) (液态海洋与径流)
 *   S1: H₂O(g) (大气水蒸气)
 *   S2: H₂O(s) (极地冰盖与降雪)
 */
export function createPlanetaryHydrologyHypergraph(): CompiledReactionHypergraph {
  const species: SpeciesDef[] = [
    makeSpeciesFromCompound(0, 'h2o_l', 'H2Ol', 'substrate', { diffusivityM2s: 0.075 }),
    makeSpeciesFromCompound(1, 'h2o_g', 'H2Og', 'intermediate', { diffusivityM2s: 0.22 }),
    makeSpeciesFromCompound(2, 'h2o_s', 'H2Os', 'product', { diffusivityM2s: 0.012 }),
  ];

  const reactions: ReactionDef[] = [
    {
      id: 'hydro_evap_cond',
      uiName: '太阳蒸发 / 对流降水',
      uiEquationLabel: 'H₂O(l) ⇌ H₂O(g)',
      reactants: [{ speciesIndex: 0, stoich: 1, order: 1 }],
      products: [{ speciesIndex: 1, stoich: 1, order: 1 }],
      forwardA: 4.2,
      forwardEaJ: 5600,
      tempExponentBeta: 0,
      isReversible: true,
      reverseA: 0.24,
      reverseEaJ: 1100,
      enthalpyChangeJ: 1950,
      minTempK: 230,
      maxTempK: 1300,
      minPressureAtm: 0.01,
      maxPressureAtm: 400,
    },
    {
      id: 'hydro_freeze_melt',
      uiName: '极地冻结 / 吸热融水',
      uiEquationLabel: 'H₂O(l) ⇌ H₂O(s)',
      reactants: [{ speciesIndex: 0, stoich: 1, order: 1 }],
      products: [{ speciesIndex: 2, stoich: 1, order: 1 }],
      forwardA: 0.48,
      forwardEaJ: 900,
      tempExponentBeta: 0,
      isReversible: true,
      reverseA: 4.5,
      reverseEaJ: 5400,
      enthalpyChangeJ: -850,
      minTempK: 100,
      maxTempK: 288,
      minPressureAtm: 0.01,
      maxPressureAtm: 400,
    },
    {
      id: 'hydro_sublimation',
      uiName: '冰盖升华 / 凝华降雪',
      uiEquationLabel: 'H₂O(s) ⇌ H₂O(g)',
      reactants: [{ speciesIndex: 2, stoich: 1, order: 1 }],
      products: [{ speciesIndex: 1, stoich: 1, order: 1 }],
      forwardA: 1.1,
      forwardEaJ: 5200,
      tempExponentBeta: 0,
      isReversible: true,
      reverseA: 0.28,
      reverseEaJ: 1400,
      enthalpyChangeJ: 2200,
      minTempK: 100,
      maxTempK: 282,
      minPressureAtm: 0.01,
      maxPressureAtm: 300,
    },
  ];

  return compileReactionHypergraph(
    'planetary_hydrology',
    '行星三相水循环超图 (液态海洋 ⇌ 水蒸气 ⇌ 极地冰盖)',
    species,
    reactions,
  );
}

