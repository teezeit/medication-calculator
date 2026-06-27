import { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { computeConcentrations } from "./model";
import type { DoseEntry } from "./model";
import { buildFigure } from "./chart";
import { parseTime, decimalHourToHHMM, concAtTime } from "./utils";

type DoseRow = { medication: string; time: string; mg: number };

const DEFAULT_DOSES_1: DoseRow[] = [
  { medication: "elvanse", time: "07:30", mg: 40 },
  { medication: "elvanse", time: "12:00", mg: 30 },
];
const DEFAULT_DOSES_2: DoseRow[] = [
  { medication: "elvanse", time: "07:30", mg: 70 },
];

const STORAGE_KEY = "medbuddy_v1";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state: object) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable — silently skip
  }
}

function rowsToDoseEntries(rows: DoseRow[]): DoseEntry[] {
  return rows
    .filter((r) => r.time && r.mg > 0)
    .map((r) => [parseTime(r.time), r.mg] as DoseEntry);
}

function nowHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}


function DoseTable({
  rows,
  onChange,
}: {
  rows: DoseRow[];
  onChange: (rows: DoseRow[]) => void;
}) {
  const update = (i: number, field: keyof DoseRow, value: string | number) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  return (
    <div className="w-full">
      <div className="divide-y divide-gray-100">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2 py-2">
            <input
              type="time"
              value={row.time}
              onChange={(e) => update(i, "time", e.target.value)}
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            />
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2">
              <input
                type="number"
                value={row.mg}
                min={0}
                max={70}
                step={5}
                onChange={(e) => update(i, "mg", parseInt(e.target.value) || 0)}
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
                <path
                  d="M1 1l12 12M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() =>
          onChange([
            ...rows,
            { medication: "elvanse", time: nowHHMM(), mg: 10 },
          ])
        }
        className="mt-2 w-full border border-dashed border-gray-200 rounded-lg py-2 text-sm text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors"
      >
        + Add dose
      </button>
    </div>
  );
}

export default function App() {
  const saved = loadState();
  const [activeTab, setActiveTab] = useState<"single" | "compare">(saved?.activeTab ?? "single");
  const [doses1, setDoses1] = useState<DoseRow[]>(saved?.doses1 ?? DEFAULT_DOSES_1);
  const [doses2, setDoses2] = useState<DoseRow[]>(saved?.doses2 ?? DEFAULT_DOSES_2);
  const [compareMode, setCompareMode] = useState<boolean>(saved?.compareMode ?? false);
  const [threshold, setThreshold] = useState<number>(saved?.threshold ?? 20);
  const [isMobile, setIsMobile] = useState(true);

  const [displayedConc, setDisplayedConc] = useState(0);
  const [displayedTime, setDisplayedTime] = useState(nowHHMM());
  const [isHovering, setIsHovering] = useState(false);
  const currentConcRef = useRef(0);
  const currentTimeStrRef = useRef(nowHHMM());

  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 600);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    saveState({ activeTab, doses1, doses2, compareMode, threshold });
  }, [activeTab, doses1, doses2, compareMode, threshold]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const now = new Date();
    const currentTime = now.getHours() + now.getMinutes() / 60;
    const timeStr = nowHHMM();

    const entries1 = rowsToDoseEntries(doses1);
    const entries2 = rowsToDoseEntries(doses2);
    if (entries1.length === 0) return;

    const schedules: DoseEntry[][] =
      activeTab === "compare" && compareMode && entries2.length > 0
        ? [entries1, entries2]
        : [entries1];

    const results = schedules.map(computeConcentrations);
    const curConc = concAtTime(results[0], currentTime);

    currentConcRef.current = curConc;
    currentTimeStrRef.current = timeStr;
    setDisplayedConc(curConc);
    setDisplayedTime(timeStr);

    const { data, layout } = buildFigure(results, { threshold, currentTime });
    const el = chartRef.current as unknown as Plotly.PlotlyHTMLElement;

    Plotly.react(el, data, layout as Plotly.Layout, {
      responsive: true,
      displayModeBar: false,
    });

    el.removeAllListeners("plotly_hover");
    el.removeAllListeners("plotly_unhover");

    el.on("plotly_hover", (event: Plotly.PlotHoverEvent) => {
      const totalPoint = event.points.find((p) =>
        (p.data as unknown as Record<string, unknown>).name
          ?.toString()
          .startsWith("Total"),
      );
      if (totalPoint) {
        setDisplayedConc(totalPoint.y as number);
        setDisplayedTime(decimalHourToHHMM(totalPoint.x as number));
        setIsHovering(true);
      }
    });

    el.on("plotly_unhover", () => {
      setDisplayedConc(currentConcRef.current);
      setDisplayedTime(currentTimeStrRef.current);
      setIsHovering(false);
    });

  }, [doses1, doses2, threshold, compareMode, isMobile, activeTab, tick]);

  const isAbove = displayedConc >= threshold;

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">
        ADHD Medication Tracker
      </h1>
      <p className="text-gray-400 text-sm mb-6">
        Figure out when and how much to take.
      </p>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 mb-4">
        {(["single", "compare"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            {tab === "single" ? "My Medication" : "Compare"}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400 mb-1">
        Elvanse · more medications coming soon
      </p>

      {activeTab === "single" && (
        <DoseTable rows={doses1} onChange={setDoses1} />
      )}

      {activeTab === "compare" && (
        <div
          className={`grid gap-6 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}
        >
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
                onChange={(e) => setCompareMode(e.target.checked)}
                className="rounded"
              />
              Compare mode
            </label>
          </div>
        </div>
      )}


      {/* Value display */}
      <div className="mt-8 mb-1 text-center">
        <p className="text-xs text-gray-400 mb-0.5 tabular-nums">
          {!isHovering && "Now · "}
          <span className={isHovering ? "text-gray-800" : "text-blue-500"}>{displayedTime}</span>
        </p>
        <div className="flex items-baseline justify-center gap-1.5">
          <span className="text-5xl font-bold tracking-tight tabular-nums">
            {displayedConc.toFixed(0)}
          </span>
          <span className="text-sm text-gray-400">ng/mL</span>
        </div>
        <div
          className={`mt-1.5 flex items-center justify-center gap-1.5 text-xs font-medium ${isAbove ? "text-green-600" : "text-red-500"}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${isAbove ? "bg-green-500" : "bg-red-400"}`}
          />
          {isAbove ? "Above threshold" : "Below threshold"}
        </div>
      </div>

      {/* Chart */}
      <div ref={chartRef} className="w-full mt-6" style={{ height: '240px' }} />

      {/* Threshold stepper */}
      <div className="flex items-center justify-between mt-3 px-1">
        <span className="text-xs text-gray-400">Personal threshold</span>
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setThreshold(t => Math.max(0, t - 5))}
            className="w-11 h-9 flex items-center justify-center text-green-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
            aria-label="Decrease threshold"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="border-l border-r border-gray-200 px-4 h-9 flex items-center">
            <span className="text-sm font-medium text-green-600 tabular-nums">{threshold}</span>
          </div>
          <button
            onClick={() => setThreshold(t => Math.min(200, t + 5))}
            className="w-11 h-9 flex items-center justify-center text-green-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
            aria-label="Increase threshold"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
