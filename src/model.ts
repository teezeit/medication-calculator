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
