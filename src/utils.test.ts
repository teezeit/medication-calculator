import { describe, it, expect } from 'vitest'
import { parseTime, decimalHourToHHMM, concAtTime } from './utils'
import { computeConcentrations } from './model'

describe('parseTime', () => {
  it('converts HH:MM to decimal hours', () => {
    expect(parseTime('07:30')).toBe(7.5)
    expect(parseTime('12:00')).toBe(12)
    expect(parseTime('00:00')).toBe(0)
    expect(parseTime('23:45')).toBeCloseTo(23.75, 5)
  })

  it('is inverse of decimalHourToHHMM', () => {
    expect(parseTime(decimalHourToHHMM(7.5))).toBe(7.5)
    expect(parseTime(decimalHourToHHMM(13.25))).toBeCloseTo(13.25, 2)
  })
})

describe('decimalHourToHHMM', () => {
  it('converts decimal hours to HH:MM string', () => {
    expect(decimalHourToHHMM(7.5)).toBe('07:30')
    expect(decimalHourToHHMM(12)).toBe('12:00')
    expect(decimalHourToHHMM(0)).toBe('00:00')
    expect(decimalHourToHHMM(23.75)).toBe('23:45')
  })

  it('pads single-digit hours', () => {
    expect(decimalHourToHHMM(9)).toBe('09:00')
    expect(decimalHourToHHMM(9.5)).toBe('09:30')
  })
})

describe('concAtTime', () => {
  const result = computeConcentrations([[7.5, 40]])

  it('returns 0 before the dose time', () => {
    expect(concAtTime(result, 5)).toBe(0)
    expect(concAtTime(result, 7)).toBe(0)
  })

  it('returns a positive value after the dose time', () => {
    expect(concAtTime(result, 10)).toBeGreaterThan(0)
    expect(concAtTime(result, 14)).toBeGreaterThan(0)
  })

  it('returns 0 when hour is beyond the time array', () => {
    expect(concAtTime(result, 25)).toBe(0)
  })

  it('matches the peak concentration region', () => {
    const peak = Math.max(...result.total)
    const peakIdx = result.total.indexOf(peak)
    const peakTime = result.timeArray[peakIdx]
    expect(concAtTime(result, peakTime)).toBeCloseTo(peak, 1)
  })
})
