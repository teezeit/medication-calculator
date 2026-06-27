import { describe, it, expect } from 'vitest'
import { computeConcentrations, PARAMS } from './model'

// Reference values pre-computed from Python fit.py
const { Cmax, Ka, Ke } = PARAMS
function biExp(t: number): number {
  return (Cmax * Ka / (Ka - Ke)) * (Math.exp(-Ke * t) - Math.exp(-Ka * t))
}

describe('biExponential (via PARAMS)', () => {
  it('is 0 at t=0', () => {
    expect(biExp(0)).toBeCloseTo(0, 10)
  })

  it('matches Python reference at t=1: 0.7192133612881721', () => {
    expect(biExp(1)).toBeCloseTo(0.7192133612881721, 8)
  })

  it('is positive for t > 0', () => {
    expect(biExp(1)).toBeGreaterThan(0)
    expect(biExp(5)).toBeGreaterThan(0)
  })
})

describe('computeConcentrations — time array', () => {
  it('has 1140 points', () => {
    const { timeArray } = computeConcentrations([[7.5, 40]])
    expect(timeArray).toHaveLength(1140)
  })

  it('starts at 5 and ends at 24', () => {
    const { timeArray } = computeConcentrations([[7.5, 40]])
    expect(timeArray[0]).toBe(5)
    expect(timeArray[1139]).toBe(24)
  })
})

describe('computeConcentrations — pre-dose zeroes', () => {
  it('individual concentration is 0 before dose time', () => {
    const doseHour = 10
    const { timeArray, individual } = computeConcentrations([[doseHour, 40]])
    const preCount = timeArray.filter(t => t <= doseHour).length
    expect(individual[0].slice(0, preCount).every(v => v === 0)).toBe(true)
  })
})

describe('computeConcentrations — single dose', () => {
  it('individual sums to total', () => {
    const { total, individual } = computeConcentrations([[7.5, 40]])
    expect(individual).toHaveLength(1)
    total.forEach((t, i) => {
      expect(t).toBeCloseTo(individual[0][i], 10)
    })
  })

  it('max concentration matches Python reference (40mg at 7:30 → 37.079)', () => {
    const { total } = computeConcentrations([[7.5, 40]])
    expect(Math.max(...total)).toBeCloseTo(37.079284002218195, 2)
  })
})

describe('computeConcentrations — two doses', () => {
  it('individual arrays sum to total', () => {
    const { total, individual } = computeConcentrations([[7.5, 40], [12, 30]])
    expect(individual).toHaveLength(2)
    total.forEach((t, i) => {
      expect(t).toBeCloseTo(individual[0][i] + individual[1][i], 10)
    })
  })
})

describe('computeConcentrations — dose scaling', () => {
  it('concentration scales linearly with dose amount', () => {
    const r40 = computeConcentrations([[7.5, 40]])
    const r20 = computeConcentrations([[7.5, 20]])
    r40.total.forEach((t, i) => {
      expect(t).toBeCloseTo(r20.total[i] * 2, 10)
    })
  })
})
