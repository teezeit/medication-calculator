import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Plotly from "plotly.js-dist-min";
import { computeSchedule, DEFAULT_ONSET_MINUTES } from "./model";
import type { Dose, MedicationId } from "./model";
import { buildFigure } from "./chart";
import { parseTime, decimalHourToHHMM, concAtTime } from "./utils";

type DoseRow = { medication: MedicationId; time: string; mg: number; alarm?: boolean };

const MEDICATION_LABELS: Record<MedicationId, string> = {
  elvanse: "Elvanse",
  medikinet: "Medikinet",
  concerta: "Concerta",
};

const SELECTABLE_MEDICATIONS: MedicationId[] = ["elvanse", "medikinet", "concerta"];

// Wearing-off strength ceiling per medication - level 50 always maps to 1x (the literature-
// sourced baseline), but level 100 maps to this multiplier instead of a flat 4x for everyone.
// Medikinet/Concerta's tolerance rate is small by design (real MPH tachyphylaxis is mild, and
// Concerta's ascending profile actively suppresses it further - see model.ts), which left almost
// no visible curve difference across the slider's full range even at 4x. Elvanse's 4x ceiling
// already gives a clearly tunable curve, so it's left alone.
const TOLERANCE_CEILINGS: Record<MedicationId, number> = { elvanse: 4, medikinet: 12, concerta: 12 };

function toleranceMultiplierFromLevel(level: number, medication: MedicationId): number {
  const ceiling = TOLERANCE_CEILINGS[medication];
  return level <= 50 ? level / 50 : 1 + ((level - 50) / 50) * (ceiling - 1);
}

const DEFAULT_DOSES_1: DoseRow[] = [
  { medication: "elvanse", time: "07:30", mg: 40 },
  { medication: "elvanse", time: "12:00", mg: 30 },
];
const DEFAULT_DOSES_2: DoseRow[] = [
  { medication: "elvanse", time: "07:30", mg: 70 },
  { medication: "medikinet", time: "14:00", mg: 20 },
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

function mapValues(record: Record<MedicationId, number>, fn: (v: number) => number): Record<MedicationId, number> {
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, fn(v)]),
  ) as Record<MedicationId, number>;
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

function HelpStep({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 border border-gray-200 rounded-lg p-3">
      <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full bg-gray-900 text-white text-xs font-semibold tabular-nums">
        {number}
      </div>
      <div className="text-sm">
        <p className="font-medium text-gray-800">{title}</p>
        <div className="text-gray-500 mt-0.5">{children}</div>
      </div>
    </div>
  );
}

const HELP_ICONS = {
  threshold: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </svg>
  ),
  onset: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  wearingOff: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M4 8l6 6 3-3 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 18h5v-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  effect: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M13 3L5 14h5l-1 7 8-11h-5l1-7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};

const HELP_ICON_COLORS = {
  threshold: "bg-green-50 text-green-500",
  onset: "bg-blue-50 text-blue-500",
  wearingOff: "bg-orange-50 text-orange-500",
  effect: "bg-purple-50 text-purple-500",
};

function HelpAdjustRow({
  icon,
  from,
  to,
}: {
  icon: keyof typeof HELP_ICONS;
  from: string;
  to: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full ${HELP_ICON_COLORS[icon]}`}>
        {HELP_ICONS[icon]}
      </span>
      <span className="text-gray-500">{from}</span>
      <span className="text-gray-300">&rarr;</span>
      <span className="text-gray-700 font-medium">{to}</span>
    </div>
  );
}

// Renders a raw values array as a smooth sparkline path, scaled to fill the given box.
function sparklinePath(values: number[], width: number, height: number): string {
  const maxY = Math.max(...values, 1);
  const step = width / (values.length - 1);
  return values
    .map((y, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - (y / maxY) * height).toFixed(1)}`)
    .join(" ");
}

const MEDICATION_EXAMPLE_DOSE: Record<MedicationId, number> = { elvanse: 40, medikinet: 20, concerta: 36 };

const MEDICATION_ELI5: Record<MedicationId, { title: string; explanation: string }> = {
  elvanse: {
    title: "Why Elvanse rises and falls smoothly",
    explanation:
      "The capsule itself is inactive - it's a \"prodrug\". Your body has to slowly chop it apart (in your red blood cells) before it becomes real medication. That slow chopping-up process is the rate-limiting step, which is why the curve is one smooth hump that rises and fades gradually over many hours instead of hitting all at once.",
  },
  medikinet: {
    title: "Why Medikinet has two bumps",
    explanation:
      "The capsule contains two different kinds of pearls: white ones that dissolve right away, and blue ones with a special coating that only dissolves once it hits your gut later on. Each kind of pearl makes its own little peak, which is why the curve has two separate bumps instead of one.",
  },
  concerta: {
    title: "Why Concerta climbs steadily instead of peaking",
    explanation:
      "The outer coating (about 22% of the dose) dissolves immediately, giving a small early bump. Underneath is a tiny osmotic pump: water seeps in through the shell and pushes the rest of the medication out through a laser-drilled hole - at a rate engineered to speed up over the day. There's no single moment where it \"peaks and drops\" like a normal pill - after that early bump it just climbs steadily for hours, then tapers off once the pump runs dry.",
  },
};

function MedicationEli5Card({ medication }: { medication: MedicationId }) {
  const doseMg = MEDICATION_EXAMPLE_DOSE[medication];
  const result = computeSchedule([{ time: 7, mg: doseMg, medication }]);
  const path = sparklinePath(result.total, 200, 48);
  const { title, explanation } = MEDICATION_ELI5[medication];

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <p className="text-xs font-semibold text-gray-600 mb-2">{MEDICATION_LABELS[medication]}</p>
      <svg width="100%" height="48" viewBox="0 0 200 48" preserveAspectRatio="none" className="text-gray-400">
        <path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
      <p className="text-xs font-medium text-gray-700 mt-2">{title}</p>
      <p className="text-xs text-gray-500 mt-1">{explanation}</p>
    </div>
  );
}

function SettingStepper({
  label,
  hint,
  value,
  unit,
  step,
  min,
  max,
  onChange,
  icon,
}: {
  label: string;
  hint: string;
  value: number;
  unit?: string;
  step: number;
  min: number;
  max: number;
  onChange: (updater: (v: number) => number) => void;
  icon?: keyof typeof HELP_ICONS;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon && (
          <span className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full ${HELP_ICON_COLORS[icon]}`}>
            {HELP_ICONS[icon]}
          </span>
        )}
        <div>
          <span className="text-xs text-gray-400">{label}</span>
          <p className="text-[11px] text-gray-300">{hint}</p>
        </div>
      </div>
      <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => onChange((v) => Math.max(min, v - step))}
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors"
          aria-label={`Decrease ${label}`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <div className="border-l border-r border-gray-200 px-3 h-9 flex items-center">
          <span className="text-sm font-medium text-gray-700 tabular-nums">
            {value}{unit ? ` ${unit}` : ""}
          </span>
        </div>
        <button
          onClick={() => onChange((v) => Math.min(max, v + step))}
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors"
          aria-label={`Increase ${label}`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function shiftHour(time: string, delta: number): string {
  const [h, m] = time.split(":").map((n) => parseInt(n) || 0);
  const newHour = ((h + delta) % 24 + 24) % 24;
  return `${String(newHour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// iOS Safari (outside an installed home-screen PWA) has no Notification API at all - hide the
// alarm toggle entirely there rather than showing a bell that can never fire.
const ALARMS_SUPPORTED = typeof window !== "undefined" && "Notification" in window;

function DoseTable({
  rows,
  onChange,
}: {
  rows: DoseRow[];
  onChange: (rows: DoseRow[]) => void;
}) {
  const update = (i: number, field: keyof DoseRow, value: string | number | boolean) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const [rowNotice, setRowNotice] = useState<{ index: number; type: "blocked" | "confirmed" } | null>(null);

  useEffect(() => {
    if (!rowNotice) return;
    const id = setTimeout(() => setRowNotice(null), 6000);
    return () => clearTimeout(id);
  }, [rowNotice]);

  const toggleAlarm = async (i: number, row: DoseRow) => {
    if (row.alarm) {
      update(i, "alarm", false);
      setRowNotice(null);
      return;
    }

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      setRowNotice({ index: i, type: "blocked" });
      return;
    }

    update(i, "alarm", true);
    new Notification("Alarm set", {
      body: `${MEDICATION_LABELS[row.medication]} ${row.mg}mg at ${row.time} - keep this tab open for it to fire.`,
    });
    setRowNotice({ index: i, type: "confirmed" });
  };

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
              {ALARMS_SUPPORTED && (
                <button
                  onClick={() => toggleAlarm(i, row)}
                  className={`w-8 h-8 flex-shrink-0 flex items-center justify-center transition-colors rounded-lg ml-auto ${
                    row.alarm ? "text-blue-500" : "text-gray-300 hover:text-gray-400"
                  }`}
                  aria-label={row.alarm ? "Disable alarm" : "Enable alarm"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={row.alarm ? "currentColor" : "none"}>
                    <path
                      d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
              <button
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                className={`w-8 h-8 flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors rounded-lg ${
                  ALARMS_SUPPORTED ? "" : "ml-auto"
                }`}
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
            {rowNotice?.index === i && (
              <p className={`text-[11px] mt-1.5 ${rowNotice.type === "blocked" ? "text-red-400" : "text-blue-400"}`}>
                {rowNotice.type === "blocked"
                  ? "Notifications blocked - check browser/OS notification settings for this site."
                  : "Alarm set - keep this tab open for it to fire."}
              </p>
            )}
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
  const [activeTab, setActiveTab] = useState<"single" | "compare" | "help">(saved?.activeTab ?? "single");
  const [doses1, setDoses1] = useState<DoseRow[]>(saved?.doses1 ?? DEFAULT_DOSES_1);
  const [doses2, setDoses2] = useState<DoseRow[]>(saved?.doses2 ?? DEFAULT_DOSES_2);
  const [threshold, setThreshold] = useState<number>(saved?.threshold ?? 20);
  const [onsetMinutes, setOnsetMinutes] = useState<number>(saved?.onsetMinutes ?? DEFAULT_ONSET_MINUTES);
  // Plain 0-100 scale, no "%" - a "tolerance %" reads as "how tolerant you are" (backwards).
  // 50 is the default/baseline wearing-off strength; internally scaled to the model's
  // toleranceStrength multiplier (level/50, so 50 -> 1x). Per medication since they have
  // different tolerance mechanisms (see toleranceRateFor in model.ts) and wear off at
  // different rates for different people.
  const [toleranceLevels, setToleranceLevels] = useState<Record<MedicationId, number>>(
    saved?.toleranceLevels ?? { elvanse: 50, medikinet: 50, concerta: 50 },
  );
  // Same plain 0-100 scale as wearing-off strength (50 -> 1x). Captures personal sensitivity -
  // some people feel a given medication more strongly than another at an equivalent dose (e.g.
  // MPH exposure varies enormously by CES1 genotype), independent of how fast it wears off.
  const [effectStrengths, setEffectStrengths] = useState<Record<MedicationId, number>>(
    saved?.effectStrengths ?? { elvanse: 50, medikinet: 50, concerta: 50 },
  );
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
    saveState({ activeTab, doses1, doses2, threshold, onsetMinutes, toleranceLevels, effectStrengths });
  }, [activeTab, doses1, doses2, threshold, onsetMinutes, toleranceLevels, effectStrengths]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fires a Notification for each alarm-enabled dose whose time matches the current minute -
  // recurs every day the row stays enabled, since it checks the clock rather than scheduling a
  // fixed one-shot delay. Relies on the tab staying open (no service worker): closing or
  // reloading the tab, or the OS suspending the tab, means missed alarms.
  const firedAlarmsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!("Notification" in window)) return;

    const now = new Date();
    const nowHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const dayKey = now.toDateString();
    const rows = activeTab === "compare" ? [...doses1, ...doses2] : doses1;

    rows.forEach((r, idx) => {
      if (!r.alarm || r.time !== nowHM) return;
      const fireKey = `${dayKey}-${idx}-${r.time}-${r.medication}-${r.mg}`;
      if (firedAlarmsRef.current.has(fireKey)) return;
      firedAlarmsRef.current.add(fireKey);
      if (Notification.permission === "granted") {
        new Notification("Dose reminder", {
          body: `${MEDICATION_LABELS[r.medication]} ${r.mg}mg at ${r.time}`,
        });
      }
    });
  }, [tick, doses1, doses2, activeTab]);

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

    const toleranceMultipliers = Object.fromEntries(
      Object.entries(toleranceLevels).map(([medication, level]) => [
        medication,
        toleranceMultiplierFromLevel(level, medication as MedicationId),
      ]),
    ) as Record<MedicationId, number>;
    const effectMultipliers = mapValues(effectStrengths, (v) => v / 50);
    const results = schedules.map((s) => computeSchedule(s, onsetMinutes, toleranceMultipliers, effectMultipliers));
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

  }, [doses1, doses2, threshold, onsetMinutes, toleranceLevels, effectStrengths, isMobile, activeTab, tick]);

  const isAbove = displayedConc >= threshold;
  // Each medication's raw ng/mL is normalized by its own CMAX_PER_MG before the PD layer (see
  // cmaxPerMgFor in model.ts) so different drugs are comparable - the number is a dose-
  // equivalent effect score, not a real ng/mL reading, so label it as such.
  const concUnitLabel = "effect";

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
          <button
            onClick={() => setActiveTab("help")}
            className={`px-3 py-2.5 border-b-2 transition-colors -mb-px flex items-center justify-center ${
              activeTab === "help"
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
            aria-label="Help"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.5v.4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="17" r="0.9" fill="currentColor" />
            </svg>
          </button>
        </div>
        {activeTab !== "help" && (
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
        )}
      </div>

      {activeTab === "help" && (
        <div className="px-1 space-y-3">
          <p className="text-xs font-semibold text-gray-600 mb-1">First-time setup</p>

          <HelpStep number={1} title="Enter your real doses">
            Medication, time, and mg for a typical day.
          </HelpStep>

          <HelpStep number={2} title="Set Personal threshold">
            Roughly where you feel "on" vs "off" - you'll refine this in a later step.
          </HelpStep>

          <HelpStep number={3} title="Leave the sliders at default">
            Onset, Wearing-off strength, and Personal effect strength start at sensible defaults - don't touch them yet.
          </HelpStep>

          <HelpStep number={4} title="Compare & adjust one at a time">
            <div className="space-y-1.5 mt-1">
              <HelpAdjustRow icon="threshold" from="Above-threshold duration off" to="Personal threshold" />
              <HelpAdjustRow icon="onset" from="Kicks in earlier/later (Elvanse only)" to="Onset" />
              <HelpAdjustRow icon="wearingOff" from="Fades before the dose should be done" to="Wearing-off strength" />
              <HelpAdjustRow icon="effect" from="Hits stronger/weaker than another med" to="Personal effect strength" />
            </div>
          </HelpStep>

          <HelpStep number={5} title="Reset if overtuned">
            "Reset to defaults" in Settings puts everything back to start over.
          </HelpStep>

          <p className="text-xs text-gray-400 px-1 pt-1">
            The number on the main screen is a comparison score, not a real blood concentration - it only becomes
            useful once calibrated to match how you actually feel.
          </p>

          <p className="text-xs font-semibold text-gray-600 mb-1 pt-2">Why each curve looks the way it does</p>
          {SELECTABLE_MEDICATIONS.map((medication) => (
            <MedicationEli5Card key={medication} medication={medication} />
          ))}
        </div>
      )}

      {activeTab !== "help" && showSettings && (
        <div className="mb-4 px-1 -mt-1 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600">Settings</p>
            <button
              onClick={() => {
                setOnsetMinutes(DEFAULT_ONSET_MINUTES);
                setToleranceLevels({ elvanse: 50, medikinet: 50, concerta: 50 });
                setEffectStrengths({ elvanse: 50, medikinet: 50, concerta: 50 });
              }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Reset to defaults
            </button>
          </div>
          {SELECTABLE_MEDICATIONS.map((medication) => (
            <div key={medication}>
              <p className="text-xs font-semibold text-gray-600 mb-2">{MEDICATION_LABELS[medication]}</p>
              <div className="space-y-3">
                <SettingStepper
                  label="Wearing-off strength"
                  hint="How fast the effect fades through the day"
                  value={toleranceLevels[medication]}
                  step={10}
                  min={0}
                  max={100}
                  onChange={(updater) =>
                    setToleranceLevels((levels) => ({ ...levels, [medication]: updater(levels[medication]) }))
                  }
                  icon="wearingOff"
                />
                <SettingStepper
                  label="Personal effect strength"
                  hint="How strongly you respond to it"
                  value={effectStrengths[medication]}
                  step={10}
                  min={0}
                  max={100}
                  onChange={(updater) =>
                    setEffectStrengths((strengths) => ({ ...strengths, [medication]: updater(strengths[medication]) }))
                  }
                  icon="effect"
                />
                {medication === "elvanse" && (
                  <SettingStepper
                    label="Onset"
                    hint="When you personally start feeling it"
                    value={onsetMinutes}
                    unit="min"
                    step={5}
                    min={5}
                    max={180}
                    onChange={setOnsetMinutes}
                    icon="onset"
                  />
                )}
              </div>
            </div>
          ))}
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

      {activeTab !== "help" && (
        <>
          {/* Value display */}
          <div className="mt-8 mb-1 text-center">
            <p className="text-xs text-gray-400 mb-0.5 tabular-nums">
              {!isHovering && "Now · "}
              <span className={isHovering ? "text-gray-800" : "text-blue-500"}>{displayedTime}</span>
            </p>
            <div className="text-5xl font-bold tracking-tight tabular-nums">
              {displayedConc.toFixed(0)}
            </div>
            <p className="text-sm text-gray-400">{concUnitLabel}</p>
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
            <span className="flex items-center gap-2 text-xs text-gray-400">
              <span className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full ${HELP_ICON_COLORS.threshold}`}>
                {HELP_ICONS.threshold}
              </span>
              Personal threshold
            </span>
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
              <div className="border-l border-r border-gray-200 h-9 flex items-center">
                <input
                  type="number"
                  value={threshold}
                  min={0}
                  max={200}
                  onChange={(e) => setThreshold(Math.min(200, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="w-14 text-sm font-medium text-green-600 tabular-nums text-center bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  aria-label="Personal threshold"
                />
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
        </>
      )}
    </div>
  );
}
