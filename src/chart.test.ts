import { describe, it, expect } from 'vitest'
import { buildFigure } from './chart'
import type { ChartOptions } from './chart'
import { computeConcentrations } from './model'

const OPTIONS: ChartOptions = { threshold: 20, currentTime: 10.0, isMobile: false }

const RESULT_1DOSE = computeConcentrations([[7.5, 40]])
const RESULT_2DOSES = computeConcentrations([[7.5, 40], [12, 30]])

describe('buildFigure — trace count', () => {
  it('1 schedule 1 dose → 3 traces (1 individual + 1 total + 1 marker)', () => {
    const { data } = buildFigure([RESULT_1DOSE], OPTIONS)
    expect(data).toHaveLength(3)
  })

  it('1 schedule 2 doses → 4 traces (2 individual + 1 total + 1 marker)', () => {
    const { data } = buildFigure([RESULT_2DOSES], OPTIONS)
    expect(data).toHaveLength(4)
  })

  it('2 schedules [2+1 doses] → 6 traces (2+1 individual + 2 total + 1 marker)', () => {
    const { data } = buildFigure([RESULT_2DOSES, RESULT_1DOSE], OPTIONS)
    expect(data).toHaveLength(6)
  })
})

describe('buildFigure — threshold shape', () => {
  it('includes a horizontal line shape at the threshold y value', () => {
    const { layout } = buildFigure([RESULT_1DOSE], OPTIONS)
    const threshShape = layout.shapes?.find(
      s => (s as Record<string, unknown>).y0 === OPTIONS.threshold,
    )
    expect(threshShape).toBeDefined()
  })

  it('threshold y value reflects the options value', () => {
    const { layout } = buildFigure([RESULT_1DOSE], { ...OPTIONS, threshold: 50 })
    const threshShape = layout.shapes?.find(
      s => (s as Record<string, unknown>).y0 === 50,
    )
    expect(threshShape).toBeDefined()
  })
})

describe('buildFigure — you are here marker', () => {
  it('marker x matches currentTime', () => {
    const { data } = buildFigure([RESULT_1DOSE], OPTIONS)
    const marker = data.find(t => (t as Record<string, unknown>).name === 'you are here')
    expect((marker as Record<string, number[]>).x[0]).toBeCloseTo(OPTIONS.currentTime, 3)
  })

  it('marker y is non-negative', () => {
    const { data } = buildFigure([RESULT_1DOSE], OPTIONS)
    const marker = data.find(t => (t as Record<string, unknown>).name === 'you are here')
    expect((marker as Record<string, number[]>).y[0]).toBeGreaterThanOrEqual(0)
  })
})

describe('buildFigure — total trace names', () => {
  it('single schedule uses "Total Concentration"', () => {
    const { data } = buildFigure([RESULT_1DOSE], OPTIONS)
    const names = data.map(t => (t as Record<string, unknown>).name)
    expect(names).toContain('Total Concentration')
  })

  it('two schedules use "Option 1" and "Option 2" suffixes', () => {
    const { data } = buildFigure([RESULT_1DOSE, RESULT_1DOSE], OPTIONS)
    const names = data.map(t => (t as Record<string, unknown>).name)
    expect(names).toContain('Total Concentration Option 1')
    expect(names).toContain('Total Concentration Option 2')
  })
})

describe('buildFigure — mobile layout', () => {
  it('desktop xaxis has range [5, 24]', () => {
    const { layout } = buildFigure([RESULT_1DOSE], { ...OPTIONS, isMobile: false })
    expect((layout.xaxis as Record<string, unknown[]>)?.range).toEqual([5, 24])
  })

  it('mobile xaxis range is centered on currentTime', () => {
    const { layout } = buildFigure([RESULT_1DOSE], { ...OPTIONS, isMobile: true, currentTime: 12 })
    const range = (layout.xaxis as Record<string, number[]>)?.range
    expect(range[0]).toBeCloseTo(12 - 2.2, 3)
    expect(range[1]).toBeCloseTo(12 + 2.2, 3)
  })
})
