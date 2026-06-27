import type { ConcentrationResult } from './model'

export function parseTime(t: string): number {
  const [h = '0', m = '0'] = t.split(':')
  return parseInt(h) + parseInt(m) / 60
}

export function decimalHourToHHMM(h: number): string {
  const hours = Math.floor(h)
  const mins = Math.round((h % 1) * 60)
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

export function concAtTime(result: ConcentrationResult, hour: number): number {
  const idx = result.timeArray.findIndex(t => t >= hour)
  return idx >= 0 ? result.total[idx] : 0
}
