import type { Data, Layout } from 'plotly.js-dist-min'
import type { ConcentrationResult } from './model'

export interface ChartOptions {
  threshold: number
  currentTime: number // decimal hours, e.g. 14.5
  isMobile: boolean
}

export function buildFigure(
  results: ConcentrationResult[],
  options: ChartOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const { threshold, currentTime, isMobile } = options
  const data: Data[] = []
  const shapes: Partial<Layout>['shapes'] = []
  const multiSchedule = results.length > 1

  for (let i = 0; i < results.length; i++) {
    const { timeArray, total, individual } = results[i]

    for (const conc of individual) {
      data.push({
        x: timeArray,
        y: conc,
        mode: 'lines',
        name: 'dose',
        line: { dash: 'dot', color: 'darkgrey' },
        showlegend: false,
      } as Data)
    }

    const totalName = multiSchedule
      ? `Total Concentration Option ${i + 1}`
      : 'Total Concentration'
    data.push({
      x: timeArray,
      y: total,
      mode: 'lines',
      name: totalName,
      line: { width: 2 },
    } as Data)
  }

  // Threshold horizontal line
  shapes.push({
    type: 'line',
    xref: 'paper',
    yref: 'y',
    x0: 0, x1: 1,
    y0: threshold, y1: threshold,
    line: { color: 'black', width: 2 },
  } as Partial<Layout>['shapes'][0])

  // "you are here" vrect
  const delta = 0.25
  shapes.push({
    type: 'rect',
    xref: 'x',
    yref: 'paper',
    x0: currentTime - delta, x1: currentTime + delta,
    y0: 0, y1: 1,
    fillcolor: 'green',
    opacity: 0.25,
    line: { width: 0 },
  } as Partial<Layout>['shapes'][0])

  // "you are here" dot — uses first schedule's total
  const { timeArray: t0, total: total0 } = results[0]
  const idx = t0.findIndex(t => t >= currentTime)
  const ytime = idx >= 0 ? total0[idx] : 0

  data.push({
    x: [currentTime],
    y: [ytime],
    mode: 'markers',
    marker: {
      size: 12,
      color: 'rgba(191,223,191,0.5)',
      line: { width: 2, color: 'DarkSlateGrey' },
    },
    name: 'you are here',
  } as Data)

  const xAxis = isMobile
    ? {
        range: [currentTime - 2.2, currentTime + 2.2],
        rangeslider: { visible: true },
        type: 'linear' as const,
        dtick: 1,
        showgrid: true,
        title: { text: 'Hour of the Day' },
      }
    : {
        range: [5, 24],
        dtick: 1,
        showgrid: true,
        type: 'linear' as const,
        title: { text: 'Hour of the Day' },
      }

  const legend = isMobile
    ? { orientation: 'h' as const, yanchor: 'bottom' as const, y: -1.9, xanchor: 'center' as const, x: 0.5 }
    : { orientation: 'h' as const, yanchor: 'bottom' as const, y: -0.9, xanchor: 'center' as const, x: 0.5 }

  const layout: Partial<Layout> = {
    title: { text: 'Medication Concentration Over Time' },
    xaxis: xAxis,
    yaxis: { title: { text: 'Concentration (ng/mL)' } },
    dragmode: 'pan',
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
    autosize: true,
    legend,
    shapes,
  }

  return { data, layout }
}
