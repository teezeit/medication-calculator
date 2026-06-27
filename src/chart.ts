import type { Data, Layout } from 'plotly.js-dist-min'
import type { ConcentrationResult } from './model'

export interface ChartOptions {
  threshold: number
  currentTime: number
}

export function buildFigure(
  results: ConcentrationResult[],
  options: ChartOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const { threshold, currentTime } = options
  const data: Data[] = []
  const shapes: Partial<Layout>['shapes'] = []
  const annotations: Partial<Layout>['annotations'] = []
  const multiSchedule = results.length > 1

  const maxConc = Math.max(...results.flatMap(r => r.total))
  const yMax = Math.ceil(Math.max(maxConc, threshold) * 1.25 / 10) * 10

  // Therapeutic band as traces (shapes are all draggable with edits.shapePosition)
  data.push({
    x: [5, 24], y: [threshold, threshold],
    mode: 'lines', line: { width: 0 },
    hoverinfo: 'skip', showlegend: false,
  } as Data)
  data.push({
    x: [5, 24], y: [yMax, yMax],
    mode: 'lines', line: { width: 0 },
    fill: 'tonexty', fillcolor: 'rgba(22,163,74,0.07)',
    hoverinfo: 'skip', showlegend: false,
  } as Data)

  for (let i = 0; i < results.length; i++) {
    const { timeArray, total, individual } = results[i]

    for (const conc of individual) {
      data.push({
        x: timeArray,
        y: conc,
        mode: 'lines',
        name: 'dose',
        line: { color: 'rgba(180,180,180,0.5)', width: 1.5 },
        showlegend: false,
        hoverinfo: 'skip',
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
      line: { width: 2.5, color: '#374151' },
      hoverinfo: 'none',
    } as Data)
  }

  // "Now" dot on the first schedule's total curve
  const { timeArray: t0, total: total0 } = results[0]
  const nowIdx = t0.findIndex(t => t >= currentTime)
  const nowY = nowIdx >= 0 ? total0[nowIdx] : 0
  data.push({
    x: [currentTime],
    y: [nowY],
    mode: 'markers',
    marker: { size: 8, color: '#3b82f6', line: { width: 0 } },
    hoverinfo: 'skip',
    showlegend: false,
  } as Data)

  // shapes[0]: threshold line — draggable via edits.shapePosition
  shapes.push({
    type: 'line',
    xref: 'paper',
    yref: 'y',
    x0: 0, x1: 1,
    y0: threshold, y1: threshold,
    line: { color: 'rgba(22,163,74,0.6)', width: 2 },
  } as Partial<Layout>['shapes'][0])



  const layout: Partial<Layout> = {
    xaxis: {
      range: [5, 24],
      tickvals: [6, 9, 12, 15, 18, 21],
      ticktext: ['6am', '9am', '12pm', '3pm', '6pm', '9pm'],
      showgrid: false,
      zeroline: false,
      tickfont: { size: 11, color: '#9ca3af' },
      showspikes: false,
    },
    yaxis: {
      showgrid: true,
      gridcolor: 'rgba(243,244,246,1)',
      zeroline: false,
      tickfont: { size: 11, color: '#9ca3af' },
      range: [0, yMax],
    },
    dragmode: false,
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
    autosize: true,
    margin: { l: 32, r: 12, t: 8, b: 32 },
    showlegend: false,
    hovermode: 'x',
    shapes,
    annotations,
  }

  return { data, layout }
}
