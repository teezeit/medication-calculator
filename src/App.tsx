import { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { computeConcentrations } from './model'
import type { DoseEntry } from './model'
import { buildFigure } from './chart'

type DoseRow = { medication: string; time: string; mg: number }

const DEFAULT_DOSES_1: DoseRow[] = [
  { medication: 'elvanse', time: '07:30', mg: 40 },
  { medication: 'elvanse', time: '12:00', mg: 30 },
]
const DEFAULT_DOSES_2: DoseRow[] = [{ medication: 'elvanse', time: '07:30', mg: 70 }]

function parseTime(t: string): number {
  const [h = '0', m = '0'] = t.split(':')
  return parseInt(h) + parseInt(m) / 60
}

function rowsToDoseEntries(rows: DoseRow[]): DoseEntry[] {
  return rows
    .filter(r => r.time && r.mg > 0)
    .map(r => [parseTime(r.time), r.mg] as DoseEntry)
}

function nowHHMM() {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function DoseTable({ rows, onChange }: { rows: DoseRow[]; onChange: (rows: DoseRow[]) => void }) {
  const update = (i: number, field: keyof DoseRow, value: string | number) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))

  return (
    <div className="w-full">
      <div className="divide-y divide-gray-100">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2 py-2">
            <input
              type="time"
              value={row.time}
              onChange={e => update(i, 'time', e.target.value)}
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            />
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2">
              <input
                type="number"
                value={row.mg}
                min={0}
                max={70}
                step={5}
                onChange={e => update(i, 'mg', parseInt(e.target.value) || 0)}
                className="w-10 text-sm text-right focus:outline-none"
              />
              <span className="text-xs text-gray-400">mg</span>
            </div>
            <button
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors rounded-lg"
              aria-label="Remove dose"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => onChange([...rows, { medication: 'elvanse', time: nowHHMM(), mg: 10 }])}
        className="mt-2 w-full border border-dashed border-gray-200 rounded-lg py-2 text-sm text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors"
      >
        + Add dose
      </button>
    </div>
  )
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 16 16" fill="none"
      className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'single' | 'compare'>('single')
  const [doses1, setDoses1] = useState<DoseRow[]>(DEFAULT_DOSES_1)
  const [doses2, setDoses2] = useState<DoseRow[]>(DEFAULT_DOSES_2)
  const [compareMode, setCompareMode] = useState(false)
  const [threshold, setThreshold] = useState(20)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(true)

  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 600)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (!chartRef.current) return
    const now = new Date()
    const currentTime = now.getHours() + now.getMinutes() / 60

    const entries1 = rowsToDoseEntries(doses1)
    const entries2 = rowsToDoseEntries(doses2)
    if (entries1.length === 0) return

    const schedules: DoseEntry[][] =
      activeTab === 'compare' && compareMode && entries2.length > 0
        ? [entries1, entries2]
        : [entries1]

    const results = schedules.map(computeConcentrations)
    const { data, layout } = buildFigure(results, { threshold, currentTime, isMobile })

    Plotly.react(chartRef.current, data, layout as Plotly.Layout, {
      responsive: true,
      displayModeBar: false,
    })
  }, [doses1, doses2, threshold, compareMode, isMobile, activeTab])

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Medication Buddy</h1>
      <p className="text-gray-400 text-sm mb-6">
        Figure out when and how much to take.
      </p>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 mb-4">
        {(['single', 'compare'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab === 'single' ? 'My Medication' : 'Compare'}
          </button>
        ))}
      </div>

      {/* Medication label */}
      <p className="text-xs text-gray-400 mb-1">Elvanse · more medications coming soon</p>

      {activeTab === 'single' && <DoseTable rows={doses1} onChange={setDoses1} />}

      {activeTab === 'compare' && (
        <div className={`grid gap-6 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Option 1</p>
            <DoseTable rows={doses1} onChange={setDoses1} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Option 2</p>
            <DoseTable rows={doses2} onChange={setDoses2} />
            <label className="flex items-center gap-2 mt-3 text-sm text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={compareMode}
                onChange={e => setCompareMode(e.target.checked)}
                className="rounded"
              />
              Compare mode
            </label>
          </div>
        </div>
      )}

      {/* Settings */}
      <div className="mt-5">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ChevronDown open={settingsOpen} />
          Settings
        </button>
        {settingsOpen && (
          <div className="mt-3 pl-1">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-gray-500">Personal threshold</p>
              <span className="text-xs font-medium text-gray-700">{threshold} ng/mL</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={10}
              value={threshold}
              onChange={e => setThreshold(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        )}
      </div>

      {/* Chart */}
      <div ref={chartRef} className="mt-6 w-full" />
    </div>
  )
}
