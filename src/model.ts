export const PARAMS = {
  Cmax: 4.816931830999022,
  Ka: 0.23815199140828144,
  Ke: 0.7144975482181155,
}

function biExponential(t: number): number {
  const { Cmax, Ka, Ke } = PARAMS
  return (Cmax * Ka / (Ka - Ke)) * (Math.exp(-Ke * t) - Math.exp(-Ka * t))
}

export type DoseEntry = [number, number] // [hour, mg]

export interface ConcentrationResult {
  timeArray: number[]
  total: number[]
  individual: number[][]
}

export function computeConcentrations(doseTimes: DoseEntry[]): ConcentrationResult {
  const length = 1140
  const timeArray = Array.from({ length }, (_, i) => 5 + i * (19 / (length - 1)))
  const total = new Array<number>(length).fill(0)
  const individual: number[][] = []

  for (const [doseTime, doseAmount] of doseTimes) {
    const conc = timeArray.map(t => {
      const dt = t - doseTime
      return dt > 0 ? biExponential(dt) * doseAmount : 0
    })
    individual.push(conc)
    conc.forEach((v, i) => { total[i] += v })
  }

  return { timeArray, total, individual }
}

// --- Elvanse: corrected d-amphetamine PK + tolerance/circadian PD layers ---
// PK source: Bogen et al. 2017 (PMC5594082) - one-compartment, first-order absorption/
// elimination with a lag time for the RBC hydrolysis step. Cmax is a Bateman scale factor
// calibrated so the curve peaks at 118 ng/mL at 100mg (see llm-wiki adhd-medications topic).
//
// 'medikinet' is reserved but not yet selectable in the UI (see MEDICATION_LABELS/
// SELECTABLE_MEDICATIONS in App.tsx) - it currently falls through to the legacy PARAMS/
// biExponential fit above as a placeholder. That fit was for LDX (Elvanse's inactive prodrug),
// not methylphenidate, so it is NOT pharmacologically valid for Medikinet; it's a stand-in
// until Medikinet's own bimodal IR+ER model is implemented (next commit - see
// wiki/references/mph-pk-parameter-reference.md for the sourced parameters to use).
export type MedicationId = 'elvanse' | 'medikinet'

export interface Dose {
  time: number // decimal hour
  mg: number
  medication: MedicationId
}

const ELVANSE_PK = { Cmax: 1.559, Ka: 0.78, Ke: 0.088 }

// Bogen 2017's lag (1.5h at 100mg) is a group average from a healthy-volunteer PK study.
// Self-reported onset runs faster and fairly consistently around 30-45min (r/ADHDUK), so
// onset is a user-adjustable personal parameter rather than a fixed literature constant.
export const DEFAULT_ONSET_MINUTES = 45

function elvanseBiExponential(tSinceDose: number, doseMg: number, onsetHours: number): number {
  const { Cmax, Ka, Ke } = ELVANSE_PK
  const t = tSinceDose - onsetHours
  if (t <= 0) return 0
  return (Cmax * doseMg * Ka / (Ka - Ke)) * (Math.exp(-Ke * t) - Math.exp(-Ka * t))
}

// Tolerance compartment (Mager 2014-style): dT/dt = K_TOL*C - K_DEG*T, effective = C/(1+T).
// K_TOL is scaled per ng/mL (not per normalized concentration) since C is real plasma ng/mL -
// at a sustained C=100 this settles to T=k_tol*C/k_deg=0.33, i.e. effective=C/1.33, a ~25%
// steady-state suppression. Kept light deliberately: Cortese 2025's ~67%-suppression-strength
// tachyphylaxis is documented for subjective euphoric effects in healthy volunteers at
// research doses, not therapeutic ADHD cognitive effects - wearing-off here should be driven
// mainly by PK decline + circadian dip, with tolerance as a minor correction on top.
const TOLERANCE_K_TOL = 0.0005
const TOLERANCE_K_DEG = 0.15
export const DEFAULT_TOLERANCE_STRENGTH = 1

// Circadian gating (Shappell 1996): drug effect on plasma-identical doses varies by time of
// day. Trough at 16:00 - later than the generic post-lunch dip (14:30), consistent with
// ADHD's delayed circadian phase. A_circ=0.15 (not 0.3) - literature amplitude estimates run
// 15-20%; 0.3 combined with tolerance overcorrected the afternoon dip below threshold with
// almost no margin.
const CIRCADIAN_AMPLITUDE = 0.15
const CIRCADIAN_TROUGH = 16.0

function applyToleranceAndCircadian(timeArray: number[], rawConc: number[], toleranceStrength: number): number[] {
  const effective = new Array<number>(rawConc.length).fill(0)
  let tolerance = 0
  const kTol = TOLERANCE_K_TOL * toleranceStrength

  for (let i = 0; i < rawConc.length; i++) {
    const c = rawConc[i]
    // Negative cosine: trough (1 - A_circ) lands at CIRCADIAN_TROUGH, not a peak there.
    const circadian = 1 - CIRCADIAN_AMPLITUDE * Math.cos((2 * Math.PI * (timeArray[i] - CIRCADIAN_TROUGH)) / 24)
    const toleranceFactor = 1 / (1 + tolerance)
    effective[i] = c * toleranceFactor * circadian

    if (i < rawConc.length - 1) {
      const dt = timeArray[i + 1] - timeArray[i]
      tolerance = Math.max(0, tolerance + (kTol * c - TOLERANCE_K_DEG * tolerance) * dt)
    }
  }

  return effective
}

export function computeSchedule(
  doses: Dose[],
  onsetMinutes: number = DEFAULT_ONSET_MINUTES,
  toleranceStrength: number = DEFAULT_TOLERANCE_STRENGTH,
): ConcentrationResult {
  const length = 1140
  const timeArray = Array.from({ length }, (_, i) => 5 + i * (19 / (length - 1)))
  const total = new Array<number>(length).fill(0)
  const elvanseRaw = new Array<number>(length).fill(0)
  const individual: number[][] = []
  let hasElvanse = false
  const onsetHours = onsetMinutes / 60

  for (const dose of doses) {
    if (dose.medication === 'elvanse') {
      hasElvanse = true
      const conc = timeArray.map(t => elvanseBiExponential(t - dose.time, dose.mg, onsetHours))
      // Individual line shows this dose's own effective curve (tolerance/circadian applied
      // standalone) rather than raw plasma - matches what the combined total actually plots.
      // Tolerance from other same-day doses isn't reflected here since it's not separable
      // once doses overlap; the combined total below is the correct systemic number.
      individual.push(applyToleranceAndCircadian(timeArray, conc, toleranceStrength))
      conc.forEach((v, i) => { elvanseRaw[i] += v })
    } else {
      // 'medikinet' placeholder - see the type comment above on MedicationId.
      const conc = timeArray.map(t => {
        const dt = t - dose.time
        return dt > 0 ? biExponential(dt) * dose.mg : 0
      })
      individual.push(conc)
      conc.forEach((v, i) => { total[i] += v })
    }
  }

  if (hasElvanse) {
    const elvanseEffective = applyToleranceAndCircadian(timeArray, elvanseRaw, toleranceStrength)
    elvanseEffective.forEach((v, i) => { total[i] += v })
  }

  return { timeArray, total, individual }
}
