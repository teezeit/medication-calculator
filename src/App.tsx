import { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { computeSchedule, DEFAULT_ONSET_MINUTES } from "./model";
import type { Dose, MedicationId } from "./model";
import { buildFigure } from "./chart";
import { parseTime, decimalHourToHHMM, concAtTime } from "./utils";

type DoseRow = { medication: MedicationId; time: string; mg: number };

const MEDICATION_LABELS: Record<MedicationId, string> = {
  elvanse: "Elvanse",
  medikinet: "Medikinet",
};

const SELECTABLE_MEDICATIONS: MedicationId[] = ["elvanse", "medikinet"];

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

function rowsToDoses(rows: DoseRow[]): Dose[] {
  return rows
    .filter((r) => r.time && r.mg > 0)
    .map((r) => ({ time: parseTime(r.time), mg: r.mg, medication: r.medication }));
}

function nowHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}


// Custom 24h time entry - native <input type="time"> renders AM/PM based on OS locale
// (not the lang attribute), which Chrome/Safari on macOS ignore for this control.
function TimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [hh, mm] = value.split(":");
  const [hBuf, setHBuf] = useState(hh);
  const [mBuf, setMBuf] = useState(mm);
  const mmRef = useRef<HTMLInputElement>(null);

  useEffect(() => setHBuf(hh), [hh]);
  useEffect(() => setMBuf(mm), [mm]);

  const commit = (h: string, m: string) => {
    const hNum = Math.min(23, Math.max(0, parseInt(h) || 0));
    const mNum = Math.min(59, Math.max(0, parseInt(m) || 0));
    onChange(`${String(hNum).padStart(2, "0")}:${String(mNum).padStart(2, "0")}`);
  };

  return (
    <div className="flex items-center justify-center gap-1 px-2 py-2 text-sm">
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={hBuf}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 2);
          setHBuf(v);
          if (v.length === 2) mmRef.current?.focus();
        }}
        onBlur={(e) => {
          // Auto-advance focuses the minute field synchronously, before React re-renders
          // with the new hour digits - committing here would use the stale pre-keystroke
          // value. Skip it; the minute field's own blur commits both once it's current.
          if (e.relatedTarget !== mmRef.current) commit(hBuf, mBuf);
        }}
        className="w-5 text-center tabular-nums focus:outline-none"
        aria-label="Hour"
      />
      <span className="text-gray-400">:</span>
      <input
        ref={mmRef}
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={mBuf}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 2);
          setMBuf(v);
        }}
        onBlur={() => commit(hBuf, mBuf)}
        className="w-5 text-center tabular-nums focus:outline-none"
        aria-label="Minute"
      />
    </div>
  );
}

function shiftHour(time: string, delta: number): string {
  const [h, m] = time.split(":").map((n) => parseInt(n) || 0);
  const newHour = ((h + delta) % 24 + 24) % 24;
  return `${String(newHour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
          <div key={i} className="py-2">
            <div className="flex items-center gap-2">
              <select
                value={row.medication}
                onChange={(e) => update(i, "medication", e.target.value)}
                className="min-w-0 max-w-[11rem] px-1 py-2 text-sm text-gray-600 bg-transparent focus:outline-none"
              >
                {SELECTABLE_MEDICATIONS.map((id) => (
                  <option key={id} value={id}>
                    {MEDICATION_LABELS[id]}
                  </option>
                ))}
              </select>
              <button
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors rounded-lg ml-auto"
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
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex items-center flex-shrink-0 border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => update(i, "time", shiftHour(row.time, -1))}
                  className="w-7 h-9 flex items-center justify-center text-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  aria-label="Decrease hour"
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                <TimeInput
                  value={row.time}
                  onChange={(v) => update(i, "time", v)}
                />
                <button
                  onClick={() => update(i, "time", shiftHour(row.time, 1))}
                  className="w-7 h-9 flex items-center justify-center text-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  aria-label="Increase hour"
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center flex-shrink-0 gap-1.5 ml-auto">
                <div className="flex items-center flex-shrink-0 border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => update(i, "mg", Math.max(0, row.mg - 5))}
                    className="w-7 h-9 flex items-center justify-center text-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    aria-label="Decrease dose"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                  <input
                    type="number"
                    value={row.mg}
                    min={0}
                    max={70}
                    step={5}
                    onChange={(e) => update(i, "mg", parseInt(e.target.value) || 0)}
                    className="w-9 text-sm text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    onClick={() => update(i, "mg", Math.min(70, row.mg + 5))}
                    className="w-7 h-9 flex items-center justify-center text-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    aria-label="Increase dose"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <span className="text-xs text-gray-400">mg</span>
              </div>
            </div>
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
  const [threshold, setThreshold] = useState<number>(saved?.threshold ?? 20);
  const [onsetMinutes, setOnsetMinutes] = useState<number>(saved?.onsetMinutes ?? DEFAULT_ONSET_MINUTES);
  // Plain 0-100 scale, no "%" - a "tolerance %" reads as "how tolerant you are" (backwards).
  // 50 is the default/baseline wearing-off strength; internally scaled to the model's
  // toleranceStrength multiplier (level/50, so 50 -> 1x).
  const [toleranceLevel, setToleranceLevel] = useState<number>(saved?.toleranceLevel ?? 50);
  const [showSettings, setShowSettings] = useState(false);
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
    saveState({ activeTab, doses1, doses2, threshold, onsetMinutes, toleranceLevel });
  }, [activeTab, doses1, doses2, threshold, onsetMinutes, toleranceLevel]);

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

    const entries1 = rowsToDoses(doses1);
    const entries2 = rowsToDoses(doses2);
    if (entries1.length === 0) return;

    const schedules: Dose[][] =
      activeTab === "compare" && entries2.length > 0
        ? [entries1, entries2]
        : [entries1];

    const results = schedules.map((s) => computeSchedule(s, onsetMinutes, toleranceLevel / 50));
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

  }, [doses1, doses2, threshold, onsetMinutes, toleranceLevel, isMobile, activeTab, tick]);

  const isAbove = displayedConc >= threshold;
  // Both medications run through tolerance/circadian layers that modify effect, not plasma
  // level, so the "total" isn't a real ng/mL reading - label it for what it is rather than
  // implying a lab value.
  const concUnitLabel = "effective conc.";

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">
        ADHD Medication Tracker
      </h1>
      <p className="text-gray-400 text-sm mb-6">
        Figure out when and how much to take.
      </p>

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-gray-100 mb-4">
        <div className="flex">
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
        <button
          onClick={() => setShowSettings((s) => !s)}
          className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg transition-colors ${
            showSettings ? "text-gray-700 bg-gray-100" : "text-gray-300 hover:text-gray-500"
          }`}
          aria-label="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 15a3 3 0 100-6 3 3 0 000 6z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </div>

      {showSettings && (
        <div className="mb-4 px-1 -mt-1 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">Settings</p>

            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-xs text-gray-400">{MEDICATION_LABELS.elvanse} onset</span>
                <p className="text-[11px] text-gray-300">When you personally start feeling it</p>
              </div>
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setOnsetMinutes((m) => Math.max(5, m - 5))}
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  aria-label="Decrease onset"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                <div className="border-l border-r border-gray-200 px-3 h-9 flex items-center">
                  <span className="text-sm font-medium text-gray-700 tabular-nums">{onsetMinutes} min</span>
                </div>
                <button
                  onClick={() => setOnsetMinutes((m) => Math.min(180, m + 5))}
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  aria-label="Increase onset"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-400">Wearing-off strength</span>
                <p className="text-[11px] text-gray-300">How fast the effect fades through the day</p>
              </div>
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setToleranceLevel((t) => Math.max(0, t - 10))}
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  aria-label="Decrease wearing-off strength"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                <div className="border-l border-r border-gray-200 px-3 h-9 flex items-center">
                  <span className="text-sm font-medium text-gray-700 tabular-nums">{toleranceLevel}</span>
                </div>
                <button
                  onClick={() => setToleranceLevel((t) => Math.min(100, t + 10))}
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  aria-label="Increase wearing-off strength"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "single" && (
        <DoseTable rows={doses1} onChange={setDoses1} />
      )}

      {activeTab === "compare" && (
        <div
          className={`grid gap-6 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}
        >
          <div>
            <DoseTable rows={doses1} onChange={setDoses1} />
          </div>
          <div>
            <DoseTable rows={doses2} onChange={setDoses2} />
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
          <span className="text-sm text-gray-400">{concUnitLabel}</span>
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
