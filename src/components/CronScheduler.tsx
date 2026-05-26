import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

// ── constants ────────────────────────────────────────────────────────────────

const ALL_HOURS   = Array.from({ length: 24 }, (_, i) => i);
const ALL_MINUTES = Array.from({ length: 60 }, (_, i) => i);
const MINUTES_PREVIEW = 24; // 2 rows of 12

// ── helpers ──────────────────────────────────────────────────────────────────

function hourLabel(h: number): string {
  if (h === 0)  return "12AM";
  if (h < 12)   return `${h}AM`;
  if (h === 12) return "12PM";
  return `${h - 12}PM`;
}

function parseCronField(field: string, max: number): number[] {
  if (field === "*") return [];
  if (/^\*\/\d+$/.test(field)) {
    const step = parseInt(field.slice(2));
    const out: number[] = [];
    for (let i = 0; i < max; i += step) out.push(i);
    return out;
  }
  return field.split(",").map(Number).filter(n => !isNaN(n) && n >= 0 && n < max);
}

function parseCron(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { minutes: [] as number[], hours: [] as number[], weekdays: [] as number[] };
  // dow: cron uses 1–7 (1=Sun), our UI uses 0–6 (0=Sun) — subtract 1 when parsing
  const rawDow = parseCronField(parts[4], 8);
  const weekdays = rawDow
    .map(d => d - 1)
    .filter(d => d >= 0 && d <= 6);
  return {
    minutes:  parseCronField(parts[0], 60),
    hours:    parseCronField(parts[1], 24),
    weekdays,
  };
}

function toField(arr: number[], total: number): string {
  if (!arr.length || arr.length === total) return "*";
  return [...arr].sort((a, b) => a - b).join(",");
}

// dow: cron crate expects 1–7 (1=Sun … 7=Sat), our state is 0–6 — add 1 when building
function buildDow(weekdays: number[]): string {
  if (!weekdays.length || weekdays.length === 7) return "*";
  return [...weekdays].sort((a, b) => a - b).map(d => d + 1).join(",");
}

function buildCron(minutes: number[], hours: number[], weekdays: number[]): string {
  return `${toField(minutes, 60)} ${toField(hours, 24)} * * ${buildDow(weekdays)}`;
}

function buildSummary(minutes: number[], hours: number[], weekdays: number[], t: TFunction): string {
  const wds  = [...weekdays].sort((a, b) => a - b);
  const hrs  = [...hours].sort((a, b) => a - b);
  const mins = [...minutes].sort((a, b) => a - b);

  const WEEKDAY_FULL = [
    t("cron.sunday"), t("cron.monday"), t("cron.tuesday"), t("cron.wednesday"),
    t("cron.thursday"), t("cron.friday"), t("cron.saturday"),
  ];
  const suffix    = t("cron.daySuffix");
  const andJoiner = t("cron.andJoiner");

  let dayPhrase: string;
  const everyDay = t("cron.summaryEveryDay");
  if (!wds.length || wds.length === 7) {
    dayPhrase = everyDay;
  } else {
    const names = wds.map(d => WEEKDAY_FULL[d] + suffix);
    dayPhrase = names.length === 1
      ? names[0]
      : names.slice(0, -1).join(", ") + andJoiner + names[names.length - 1];
  }

  let timePhrase = "";
  if (hrs.length === 1 && mins.length === 1) {
    const h = hrs[0], m = mins[0];
    const ampm = h < 12 ? "am" : "pm";
    const disp = h === 0 ? 12 : h > 12 ? h - 12 : h;
    timePhrase = `${disp}:${String(m).padStart(2, "0")}${ampm}`;
  } else if (hrs.length && mins.length) {
    const hStr = hrs.map(h => {
      const ampm = h < 12 ? "am" : "pm";
      const disp = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${disp}${ampm}`;
    }).join(", ");
    const mStr = mins.map(m => ":" + String(m).padStart(2, "0")).join(", ");
    timePhrase = `${hStr} ${t("cron.summaryAt")} ${mStr}`;
  } else if (hrs.length) {
    timePhrase = hrs.map(h => {
      const ampm = h < 12 ? "am" : "pm";
      const disp = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${disp}${ampm}`;
    }).join(", ");
  } else if (mins.length) {
    timePhrase = t("cron.summaryEveryHourAt") + " " + mins.map(m => ":" + String(m).padStart(2, "0")).join(", ");
  }

  if (!timePhrase) return t("cron.summaryOn", { days: dayPhrase });
  if (dayPhrase === everyDay) return t("cron.summaryEveryDayAt", { time: timePhrase });
  return t("cron.summaryOnDaysAt", { days: dayPhrase, time: timePhrase });
}

/** Compute minimum firing gap in minutes for `min hour * * *` cron patterns. */
function computeMinGapMinutes(minutes: number[], hours: number[]): number {
  // empty selection = wildcard = every value in range
  const mins = minutes.length ? minutes : Array.from({ length: 60 }, (_, i) => i);
  const hrs  = hours.length   ? hours   : Array.from({ length: 24 }, (_, i) => i);
  const firings = hrs.flatMap(h => mins.map(m => h * 60 + m)).sort((a, b) => a - b);
  if (firings.length <= 1) return 24 * 60;
  let minGap = firings[firings.length - 1] - firings[0]; // fallback
  for (let i = 1; i < firings.length; i++) minGap = Math.min(minGap, firings[i] - firings[i - 1]);
  // wrap-around gap (last firing to first firing next day)
  minGap = Math.min(minGap, 24 * 60 - firings[firings.length - 1] + firings[0]);
  return minGap;
}

// ── component ────────────────────────────────────────────────────────────────

interface Props {
  value: string;
  onChange: (cron: string) => void;
}

export default function CronScheduler({ value, onChange }: Props) {
  const { t } = useTranslation();
  const parsed = parseCron(value);
  const [weekdays, setWeekdays] = useState<number[]>(parsed.weekdays);
  const [hours,    setHours]    = useState<number[]>(parsed.hours);
  const [minutes,  setMinutes]  = useState<number[]>(parsed.minutes);
  const [showAll,  setShowAll]  = useState(false);

  const WEEKDAY_SHORT = [
    t("cron.sun"), t("cron.mon"), t("cron.tue"), t("cron.wed"),
    t("cron.thu"), t("cron.fri"), t("cron.sat"),
  ];

  // Re-initialise when the external value changes (e.g. on settings load)
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const p = parseCron(value);
    setWeekdays(p.weekdays);
    setHours(p.hours);
    setMinutes(p.minutes);
  }, [value]);

  function emit(m: number[], h: number[], w: number[]) {
    if (computeMinGapMinutes(m, h) < 30) return; // blocked by 30-min minimum
    const cron = buildCron(m, h, w);
    lastEmitted.current = cron;
    onChange(cron);
  }

  function toggle(arr: number[], val: number): number[] {
    return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
  }

  const onWeekday = (d: number) => { const w = toggle(weekdays, d); setWeekdays(w); emit(minutes, hours, w); };
  const onHour    = (h: number) => { const hs = toggle(hours, h);   setHours(hs);   emit(minutes, hs, weekdays); };
  const onMinute  = (m: number) => { const ms = toggle(minutes, m); setMinutes(ms); emit(ms, hours, weekdays); };

  const visibleMinutes = showAll ? ALL_MINUTES : ALL_MINUTES.slice(0, MINUTES_PREVIEW);
  const cron       = buildCron(minutes, hours, weekdays);
  const summary    = buildSummary(minutes, hours, weekdays, t);
  const minGapMins = computeMinGapMinutes(minutes, hours);
  const tooFrequent = minGapMins < 30;

  const cellCls = (on: boolean) =>
    `flex items-center justify-center px-1 py-1 rounded border text-[11px] cursor-pointer transition-colors select-none ${
      on
        ? "bg-white/20 border-white/30 text-white"
        : "bg-white/4 border-white/8 text-white/40 hover:border-white/20 hover:text-white"
    }`;

  return (
    <div className="flex flex-col gap-4">

      {/* Weekdays */}
      <div>
        <div className="text-xs font-semibold text-white/40 mb-2 uppercase tracking-wide">{t("cron.weekdays")}</div>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_SHORT.map((name, idx) => (
            <button
              key={idx}
              onClick={() => onWeekday(idx)}
              className={`px-3 py-1 rounded border text-xs cursor-pointer transition-colors select-none ${
                weekdays.includes(idx)
                  ? "bg-white/20 border-white/30 text-white"
                  : "bg-white/4 border-white/8 text-white/40 hover:border-white/20 hover:text-white"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Hours */}
      <div>
        <div className="text-xs font-semibold text-white/40 mb-2 uppercase tracking-wide">{t("cron.hours")}</div>
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}>
          {ALL_HOURS.map(h => (
            <button key={h} onClick={() => onHour(h)} className={cellCls(hours.includes(h))}>
              {hourLabel(h)}
            </button>
          ))}
        </div>
      </div>

      {/* Minutes */}
      <div>
        <div className="text-xs font-semibold text-white/40 mb-2 uppercase tracking-wide flex items-center gap-2">
          {t("cron.minutes")}
          <button
            onClick={() => setShowAll(v => !v)}
            className="text-white/40 hover:text-white font-normal normal-case text-xs underline cursor-pointer"
          >
            {showAll ? t("cron.showLess") : t("cron.showMore")}
          </button>
        </div>
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}>
          {visibleMinutes.map(m => (
            <button key={m} onClick={() => onMinute(m)} className={cellCls(minutes.includes(m))}>
              :{String(m).padStart(2, "0")}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="border-t border-white/8 pt-3 flex flex-col gap-1">
        {tooFrequent ? (
          <div className="text-xs text-amber-400">
            {t("cron.tooFrequent", { count: minGapMins })}
          </div>
        ) : (
          <>
            <div className="text-xs text-white/40">{t("cron.willChange")}</div>
            <div className="text-sm font-semibold text-white">{summary}</div>
          </>
        )}
        <div className="mt-1 text-xs text-white/30">
          {t("cron.cronLabel")} <code className="bg-white/6 px-1.5 py-0.5 rounded text-white/70 font-mono">{cron}</code>
        </div>
      </div>

    </div>
  );
}
