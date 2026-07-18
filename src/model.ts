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
export type MedicationId = 'elvanse' | 'medikinet' | 'concerta'

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

// --- Medikinet: bimodal methylphenidate PK + tolerance/circadian PD layers ---
// PK source: Medikinet XL SmPC (50% immediate-release + 50% pH-sensitive enteric-coated
// extended-release pellets) and mph-pk-parameter-reference.md. Two independent Bateman curves
// summed - the ER pellets don't start releasing until they clear the stomach's acidic
// environment (tlag, fed conditions only; Medikinet must be taken with food or the enteric
// coat never triggers). d-MPH clears about twice as fast as d-amphetamine (Ke=0.151/h,
// t1/2=4.6h vs 0.088/h, t1/2=7.9h for Elvanse), which is why its clinical duration (~8h) is
// much shorter.
const MEDIKINET_KE = 0.151
const MEDIKINET_KA_IR = 2
const MEDIKINET_KA_ER = 0.7
const MEDIKINET_TLAG_ER_HOURS = 3.5

// IR_CMAX_PER_MG is fit directly to the SmPC's reported Cmax (6.4 ng/mL at 20mg) - the IR
// pellets release well before the ER pellets clear tlag, so the first (and reported) peak is
// the IR component alone. ER_CMAX_PER_MG is tuned down from the naive per-component split
// (0.30) to 0.12: at equal per-component targets the two peaks summed at the second hump's
// timing overshoot the first peak by ~50%, which doesn't match the SmPC's plateau description
// (second peak roughly matching, not exceeding, the first - "does not fall below ~75% of
// Cmax1"). At 0.12 the second local maximum lands at ~95% of the first, matching that profile.
const MEDIKINET_IR_CMAX_PER_MG = 0.32
const MEDIKINET_ER_CMAX_PER_MG = 0.12

function batemanShapePeak(ka: number, ke: number): number {
  const tmax = Math.log(ka / ke) / (ka - ke)
  return (ka / (ka - ke)) * (Math.exp(-ke * tmax) - Math.exp(-ka * tmax))
}

// Scale factors chosen so each component's own peak (in isolation) equals CMAX_PER_MG * dose -
// same calibration approach as ELVANSE_PK.Cmax above.
const MEDIKINET_IR_SCALE = MEDIKINET_IR_CMAX_PER_MG / batemanShapePeak(MEDIKINET_KA_IR, MEDIKINET_KE)
const MEDIKINET_ER_SCALE = MEDIKINET_ER_CMAX_PER_MG / batemanShapePeak(MEDIKINET_KA_ER, MEDIKINET_KE)

function medikinetConcentration(tSinceDose: number, doseMg: number): number {
  if (tSinceDose <= 0) return 0

  const ir = MEDIKINET_IR_SCALE * (MEDIKINET_KA_IR / (MEDIKINET_KA_IR - MEDIKINET_KE)) *
    (Math.exp(-MEDIKINET_KE * tSinceDose) - Math.exp(-MEDIKINET_KA_IR * tSinceDose))

  const tEr = tSinceDose - MEDIKINET_TLAG_ER_HOURS
  const er = tEr <= 0 ? 0 : MEDIKINET_ER_SCALE * (MEDIKINET_KA_ER / (MEDIKINET_KA_ER - MEDIKINET_KE)) *
    (Math.exp(-MEDIKINET_KE * tEr) - Math.exp(-MEDIKINET_KA_ER * tEr))

  return (ir + er) * doseMg
}

// --- Concerta: three-Bateman OROS ascending-release approximation ---
// PK source: concerta-pk-parameter-reference.md / concerta-oros-mechanism-and-pk-model.md.
// Concerta's OROS pump delivers continuously at an ASCENDING rate (not a flat zero-order rate,
// and not a second discrete pulse), so the two-Bateman IR+ER split used for Medikinet doesn't
// fit - fitting one would fabricate a second peak that isn't in the data. Modeled instead as
// three overlapping Bateman components (22% IR overcoat + two osmotic-core layers releasing
// at increasing concentration), which stays in the existing Bateman-sum architecture while
// producing the right ascending shape. d-MPH elimination is slightly faster here than
// Medikinet (Ke=0.198/h, t1/2=3.5h vs 0.151/h, t1/2=4.6h - both from their respective FDA/SmPC
// labels).
const CONCERTA_KE = 0.198
const CONCERTA_COMPONENTS: { fraction: number; ka: number; lagHours: number }[] = [
  { fraction: 0.22, ka: 1.5, lagHours: 0 },   // IR overcoat - initial shoulder at ~1h
  { fraction: 0.35, ka: 0.4, lagHours: 0.5 }, // OROS early layer - fills the 1-4h plateau
  { fraction: 0.43, ka: 0.3, lagHours: 3.5 }, // OROS late layer - drives the ascending peak at 6-8h
]

// Target Cmax at 18mg (FDA label, the conservative of the two label-derived CMAX_PER_MG
// estimates). No closed form for a 3-component sum's peak, so CONCERTA_SCALE was found
// numerically against the unscaled shape above to hit this target.
const CONCERTA_CMAX_PER_MG = 0.21
const CONCERTA_SCALE = 0.5153

function concertaConcentration(tSinceDose: number, doseMg: number): number {
  let shape = 0
  for (const { fraction, ka, lagHours } of CONCERTA_COMPONENTS) {
    const t = tSinceDose - lagHours
    if (t <= 0) continue
    shape += fraction * (ka / (ka - CONCERTA_KE)) * (Math.exp(-CONCERTA_KE * t) - Math.exp(-ka * t))
  }
  return shape * CONCERTA_SCALE * doseMg
}

// Cross-drug normalization: each medication's raw ng/mL Cmax scale is an artifact of its own
// CMAX_PER_MG calibration (1.559 for Elvanse vs 0.32/0.21 for Medikinet/Concerta - a >5x gap
// that reflects nothing about relative clinical potency). Dividing each drug's raw
// concentration by its own CMAX_PER_MG before the PD layer cancels that calibration factor out,
// leaving a dose-equivalent unit (roughly "mg-equivalent effect") that's comparable across
// drugs - a 40mg dose of any of the three now produces a similarly-scaled peak. Without this,
// the bounded 0-2x personal-effect-strength slider below could never bridge a 5x+ baseline gap.
function cmaxPerMgFor(medication: MedicationId): number {
  if (medication === 'elvanse') return ELVANSE_PK.Cmax
  if (medication === 'medikinet') return MEDIKINET_IR_CMAX_PER_MG
  return CONCERTA_CMAX_PER_MG
}

// Tolerance compartment (Mager 2014-style): dT/dt = K_TOL*C - K_DEG*T, effective = C/(1+T).
// C here is the CMAX-normalized concentration (see cmaxPerMgFor above), not raw ng/mL, so
// K_TOL is also on the normalized scale: K_TOL_NORM = K_TOL_RAW * CMAX_PER_MG, which preserves
// each drug's originally-tuned steady-state tolerance (T_ss = K_TOL*C/K_DEG) now that C's units
// have changed.
// Elvanse (amphetamine): raw K_TOL_RAW=0.0005/(ng/mL) at CMAX_PER_MG=1.559 -> K_TOL_NORM=0.00078.
// At a sustained normalized C=64 (~100 ng/mL raw) this settles to T_ss=0.33, i.e. effective=C/1.33,
// a ~25% steady-state suppression. Kept light deliberately: Cortese 2025's ~67%-suppression
// tachyphylaxis is documented for subjective euphoric effects in healthy volunteers at research
// doses, not therapeutic ADHD cognitive effects - wearing-off here should be driven mainly by
// PK decline + circadian dip, with tolerance as a minor correction on top.
// Medikinet and Concerta (both methylphenidate): lower raw K_TOL_RAW=0.0007/(ng/mL) - MPH blocks
// DAT reuptake rather than forcing vesicular dopamine release, so it produces less tachyphylaxis
// than amphetamine (see mph-vs-amphetamine-pkpd-differences.md). Converted to their own
// normalized scales via each drug's own CMAX_PER_MG (0.32 / 0.21) rather than sharing one
// constant, since normalization is per-drug. Concerta's ascending delivery was specifically
// engineered to counteract acute tolerance (concerta-oros-mechanism-and-pk-model.md), but that's
// a PK-shape effect already captured by concertaConcentration's rising curve - the underlying
// MPH tolerance rate itself is the same mechanism as Medikinet, just renormalized.
const TOLERANCE_K_TOL_ELVANSE = 0.0005 * ELVANSE_PK.Cmax
const TOLERANCE_K_TOL_MEDIKINET = 0.0007 * MEDIKINET_IR_CMAX_PER_MG
const TOLERANCE_K_TOL_CONCERTA = 0.0007 * CONCERTA_CMAX_PER_MG
const TOLERANCE_K_DEG = 0.15
export const DEFAULT_TOLERANCE_STRENGTH = 1

// Circadian gating (Shappell 1996): drug effect on plasma-identical doses varies by time of
// day, for both drugs (same underlying alertness rhythm, not drug-specific). Trough at 16:00 -
// later than the generic post-lunch dip (14:30), consistent with ADHD's delayed circadian
// phase. A_circ=0.15 (not 0.3) - literature amplitude estimates run 15-20%; 0.3 combined with
// tolerance overcorrected the afternoon dip below threshold with almost no margin.
const CIRCADIAN_AMPLITUDE = 0.15
const CIRCADIAN_TROUGH = 16.0

function toleranceRateFor(medication: MedicationId): number {
  if (medication === 'elvanse') return TOLERANCE_K_TOL_ELVANSE
  if (medication === 'medikinet') return TOLERANCE_K_TOL_MEDIKINET
  return TOLERANCE_K_TOL_CONCERTA
}

function applyToleranceAndCircadian(
  timeArray: number[],
  rawConc: number[],
  toleranceStrength: number,
  baseKTol: number,
): number[] {
  const effective = new Array<number>(rawConc.length).fill(0)
  let tolerance = 0
  const kTol = baseKTol * toleranceStrength

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

export type ToleranceStrengths = Partial<Record<MedicationId, number>>
export type EffectStrengths = Partial<Record<MedicationId, number>>

const DEFAULT_TOLERANCE_STRENGTHS: ToleranceStrengths = { elvanse: 1, medikinet: 1, concerta: 1 }
export const DEFAULT_EFFECT_STRENGTH = 1
const DEFAULT_EFFECT_STRENGTHS: EffectStrengths = { elvanse: 1, medikinet: 1, concerta: 1 }

export function computeSchedule(
  doses: Dose[],
  onsetMinutes: number = DEFAULT_ONSET_MINUTES,
  toleranceStrengths: ToleranceStrengths = DEFAULT_TOLERANCE_STRENGTHS,
  effectStrengths: EffectStrengths = DEFAULT_EFFECT_STRENGTHS,
): ConcentrationResult {
  const length = 1140
  const timeArray = Array.from({ length }, (_, i) => 5 + i * (19 / (length - 1)))
  const total = new Array<number>(length).fill(0)
  const rawByMedication = new Map<MedicationId, number[]>()
  const individual: number[][] = []
  const onsetHours = onsetMinutes / 60

  const toleranceStrengthFor = (medication: MedicationId) =>
    toleranceStrengths[medication] ?? DEFAULT_TOLERANCE_STRENGTH
  // Personal sensitivity multiplier - MPH exposure varies enormously between people (CES1
  // genotype drives >100% CV in clearance, see mph-pk-parameter-reference.md), and even for a
  // fixed plasma level, subjective/functional response to a given drug varies person to
  // person. Applied last, after tolerance/circadian, so it scales the perceived effect rather
  // than the underlying pharmacology (tolerance still builds off actual plasma levels).
  const effectStrengthFor = (medication: MedicationId) =>
    effectStrengths[medication] ?? DEFAULT_EFFECT_STRENGTH

  for (const dose of doses) {
    const rawConc = dose.medication === 'elvanse'
      ? timeArray.map(t => elvanseBiExponential(t - dose.time, dose.mg, onsetHours))
      : dose.medication === 'medikinet'
      ? timeArray.map(t => medikinetConcentration(t - dose.time, dose.mg))
      : timeArray.map(t => concertaConcentration(t - dose.time, dose.mg))
    // Normalize to dose-equivalent units (see cmaxPerMgFor) before the PD layer, so tolerance/
    // circadian/personal-effect-strength operate on a cross-drug-comparable scale.
    const cmaxPerMg = cmaxPerMgFor(dose.medication)
    const conc = rawConc.map(v => v / cmaxPerMg)

    // Individual line shows this dose's own effective curve (tolerance/circadian applied
    // standalone) rather than raw plasma - matches what the combined total actually plots.
    // Tolerance from other same-day doses isn't reflected here since it's not separable
    // once doses overlap; the combined total below is the correct systemic number.
    const doseEffective = applyToleranceAndCircadian(
      timeArray, conc, toleranceStrengthFor(dose.medication), toleranceRateFor(dose.medication),
    )
    const doseStrength = effectStrengthFor(dose.medication)
    individual.push(doseEffective.map(v => v * doseStrength))

    const raw = rawByMedication.get(dose.medication) ?? new Array<number>(length).fill(0)
    conc.forEach((v, i) => { raw[i] += v })
    rawByMedication.set(dose.medication, raw)
  }

  for (const [medication, raw] of rawByMedication) {
    const effective = applyToleranceAndCircadian(
      timeArray, raw, toleranceStrengthFor(medication), toleranceRateFor(medication),
    )
    const strength = effectStrengthFor(medication)
    effective.forEach((v, i) => { total[i] += v * strength })
  }

  return { timeArray, total, individual }
}
