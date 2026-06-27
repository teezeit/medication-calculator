import { describe, it, expect } from 'vitest'
import { buildFigure } from './chart'
import type { ChartOptions } from './chart'
import { computeConcentrations } from './model'

const OPTIONS: ChartOptions = { threshold: 20, currentTime: 10 }

const RESULT_1DOSE = computeConcentrations([[7.5, 40]])
const RESULT_2DOSES = computeConcentrations([[7.5, 40], [12, 30]])

describe('buildFigure — trace count', () => {
  it('1 schedule 1 dose → 5 traces (2 band + 1 individual + 1 total + now dot)', () => {
    const { data } = buildFigure([RESULT_1DOSE], OPTIONS)
    expect(data).toHaveLength(5)
  })

  it('1 schedule 2 doses → 6 traces (2 band + 2 individual + 1 total + now dot)', () => {
    const { data } = buildFigure([RESULT_2DOSES], OPTIONS)
    expect(data).toHaveLength(6)
  })

  it('2 schedules [2+1 doses] → 8 traces (2 band + 3 individual + 2 total + now dot)', () => {
    const { data } = buildFigure([RESULT_2DOSES, RESULT_1DOSE], OPTIONS)
    expect(data).toHaveLength(8)
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
    const { layout } = buildFigure([RESULT_1DOSE], { threshold: 50, currentTime: 10 })
    const threshShape = layout.shapes?.find(
      s => (s as Record<string, unknown>).y0 === 50,
    )
    expect(threshShape).toBeDefined()
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


describe('buildFigure — layout', () => {
  it('xaxis range covers full day [5, 24]', () => {
    const { layout } = buildFigure([RESULT_1DOSE], OPTIONS)
    expect((layout.xaxis as Record<string, unknown[]>)?.range).toEqual([5, 24])
  })

  it('showlegend is false', () => {
    const { layout } = buildFigure([RESULT_1DOSE], OPTIONS)
    expect(layout.showlegend).toBe(false)
  })
})
