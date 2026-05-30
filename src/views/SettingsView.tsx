import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { AppSettings } from "../types";
import { LANGUAGES } from "../i18n";
import CronScheduler from "../components/CronScheduler";
import Toggle from "../components/Toggle";

const BMC_URL = "https://buymeacoffee.com/halfaxa";

function getOSStartLabel(): "startWithWindows" | "startWithMac" | "startWithLinux" {
  const p = navigator.platform.toLowerCase();
  if (p.startsWith("mac")) return "startWithMac";
  if (p.startsWith("win")) return "startWithWindows";
  return "startWithLinux";
}

const BASIC_CRONS = new Set([
  "@startup",
  "*/30 * * * *",
  "0 * * * *",
  "0 */2 * * *",
  "0 */4 * * *",
  "0 */6 * * *",
  "0 */12 * * *",
]);

function isOnceDailyCron(expr: string): boolean {
  return /^\d+ \d+ \* \* \*$/.test(expr);
}

function hourLabel12(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
const ALL_MINUTES = Array.from({ length: 60 }, (_, i) => i);

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-white/50 mb-3">
      {children}
    </p>
  );
}

export default function SettingsView({ onApiKeyChange }: { onApiKeyChange: () => void }) {
  const { t, i18n } = useTranslation();
  const [quality, setQuality] = useState("regular");
  const [orientation, setOrientation] = useState("landscape");
  const [cron, setCron] = useState("0 * * * *");
  const [scheduleTab, setScheduleTab] = useState<"basic" | "advanced">("basic");
  const [startOnLogin, setStartOnLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyLoaded, setApiKeyLoaded] = useState("");
  const [apiKeyVerifying, setApiKeyVerifying] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  const BASIC_OPTIONS = [
    { cron: "@startup",     label: t("settings.scheduleOnStartup"),  desc: t("settings.scheduleOnStartupDesc") },
    { cron: "*/30 * * * *", label: t("settings.scheduleEvery30"),    desc: "" },
    { cron: "0 * * * *",    label: t("settings.scheduleEveryHour"),  desc: "" },
    { cron: "0 */2 * * *",  label: t("settings.scheduleEvery2Hours"), desc: "" },
    { cron: "0 */4 * * *",  label: t("settings.scheduleEvery4Hours"), desc: "" },
    { cron: "0 */6 * * *",  label: t("settings.scheduleEvery6Hours"), desc: "" },
    { cron: "0 */12 * * *", label: t("settings.scheduleEvery12Hours"), desc: "" },
  ];

  const QUALITY_OPTIONS = [
    { value: "raw",     label: t("settings.qualityRaw"),     description: t("settings.qualityRawDesc") },
    { value: "full",    label: t("settings.qualityFull"),    description: t("settings.qualityFullDesc") },
    { value: "regular", label: t("settings.qualityRegular"), description: t("settings.qualityRegularDesc") },
    { value: "small",   label: t("settings.qualitySmall"),   description: t("settings.qualitySmallDesc") },
    { value: "thumb",   label: t("settings.qualityThumb"),   description: t("settings.qualityThumbDesc") },
  ];

  const ORIENTATION_OPTIONS = [
    { value: "landscape", label: t("settings.orientationLandscape"), description: t("settings.orientationLandscapeDesc") },
    { value: "portrait",  label: t("settings.orientationPortrait"),  description: t("settings.orientationPortraitDesc") },
    { value: "squarish",  label: t("settings.orientationSquarish"),  description: t("settings.orientationSquarishDesc") },
  ];

  useEffect(() => {
    Promise.all([invoke<AppSettings>("get_settings"), isEnabled()])
      .then(([s, autostart]) => {
        setQuality(s.quality);
        setOrientation(s.orientation);
        setCron(s.wallpaper_cron);
        setScheduleTab(BASIC_CRONS.has(s.wallpaper_cron) || isOnceDailyCron(s.wallpaper_cron) ? "basic" : "advanced");
        setStartOnLogin(autostart);
        const k = s.api_key ?? "";
        setApiKey(k);
        setApiKeyLoaded(k);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveApiKey = async () => {
    setApiKeyVerifying(true);
    setApiKeyError(null);
    try {
      await invoke("verify_and_save_api_key", { key: apiKey });
      setApiKeyLoaded(apiKey);
      setApiKeySaved(true);
      setTimeout(() => setApiKeySaved(false), 1500);
      onApiKeyChange();
    } catch (e) {
      setApiKeyError(String(e));
    } finally {
      setApiKeyVerifying(false);
    }
  };

  const handleStartOnLoginToggle = async (checked: boolean) => {
    try {
      if (checked) await enable(); else await disable();
      setStartOnLogin(checked);
    } catch (e) {
      setError(String(e));
    }
  };

  const persistSettings = useCallback(async (q: string, o: string, c: string) => {
    try {
      await invoke("update_settings", { quality: q, orientation: o, wallpaperCron: c });
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSaved(true);
      savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleQualityChange     = (v: string) => { setQuality(v);      persistSettings(v, orientation, cron); };
  const handleOrientationChange = (v: string) => { setOrientation(v);  persistSettings(quality, v, cron); };
  const handleCronChange        = (expr: string) => { setCron(expr);   persistSettings(quality, orientation, expr); };

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code);
    localStorage.setItem("lang", code);
  };

  // Once-a-day derived state
  const isOnceDailySelected = isOnceDailyCron(cron);
  const dailyCronParts = isOnceDailySelected ? cron.split(" ") : ["0", "8"];
  const dailyMinute = parseInt(dailyCronParts[0]);
  const dailyHour   = parseInt(dailyCronParts[1]);

  const handleOnceDailyClick = () => {
    if (!isOnceDailySelected) handleCronChange("0 8 * * *");
  };
  const handleDailyHour   = (h: number) => handleCronChange(`${dailyMinute} ${h} * * *`);
  const handleDailyMinute = (m: number) => handleCronChange(`${m} ${dailyHour} * * *`);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-white/50 text-sm">{t("common.loading")}</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6">
      <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">{t("settings.title")}</h2>
        {saved && <span className="text-xs text-emerald-400 animate-card-in">{t("settings.saved")}</span>}
      </div>

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-red-900/30 text-red-300">{error}</div>
      )}

      <div className="flex flex-col gap-8">

        {/* ── Photo ─────────────────────────────────────────────────────── */}
        <section>
          <SectionHeader>{t("settings.sectionPhoto")}</SectionHeader>
          <div className="flex flex-col gap-4 bg-white/4 rounded-2xl border border-white/8 p-4">

            {/* Orientation */}
            <div>
              <p className="text-sm font-medium text-white/70 mb-2">{t("settings.orientation")}</p>
              <div className="grid grid-cols-3 gap-2">
                {ORIENTATION_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleOrientationChange(opt.value)}
                    className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-center cursor-pointer transition-all ${
                      orientation === opt.value
                        ? "border-white/25 bg-white/10 text-white"
                        : "border-white/8 bg-white/4 text-white/60 hover:border-white/18 hover:text-white"
                    }`}
                  >
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-[11px] text-white/50">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-white/8" />

            {/* Quality */}
            <div>
              <p className="text-sm font-medium text-white/70 mb-2">{t("settings.quality")}</p>
              <div className="grid grid-cols-5 gap-1.5">
                {QUALITY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleQualityChange(opt.value)}
                    title={opt.description}
                    className={`py-2 px-1 rounded-lg border text-xs font-medium cursor-pointer transition-all ${
                      quality === opt.value
                        ? "border-white/25 bg-white/10 text-white"
                        : "border-white/8 bg-white/4 text-white/60 hover:border-white/18 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-white/50 mt-2">
                {QUALITY_OPTIONS.find(o => o.value === quality)?.description}
              </p>
            </div>
          </div>
        </section>

        {/* ── Schedule ──────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <SectionHeader>{t("settings.sectionSchedule")}</SectionHeader>
            <div className="flex rounded-lg overflow-hidden border border-white/10 mb-3">
              {(["basic", "advanced"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setScheduleTab(tab)}
                  className={`px-3 py-1 text-xs font-medium capitalize transition-colors cursor-pointer ${
                    scheduleTab === tab
                      ? "bg-white/15 text-white"
                      : "bg-white/4 text-white/60 hover:text-white"
                  }`}
                >
                  {tab === "basic" ? t("settings.scheduleBasic") : t("settings.scheduleAdvanced")}
                </button>
              ))}
            </div>
          </div>

          {scheduleTab === "basic" ? (
            <div className="flex flex-col gap-1.5">
              {BASIC_OPTIONS.map(opt => (
                <button
                  key={opt.cron}
                  onClick={() => handleCronChange(opt.cron)}
                  className={`flex items-center justify-between w-full px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-colors ${
                    cron === opt.cron
                      ? "border-white/25 bg-white/8"
                      : "border-white/8 bg-white/4 hover:border-white/16"
                  }`}
                >
                  <span className={`text-sm font-medium ${cron === opt.cron ? "text-white" : "text-white/70"}`}>
                    {opt.label}
                  </span>
                  {opt.desc && <span className="text-xs text-white/50 ml-2 shrink-0">{opt.desc}</span>}
                </button>
              ))}

              {/* ── Once a day (with inline time picker) ─────────────── */}
              <div>
                <button
                  onClick={handleOnceDailyClick}
                  className={`flex items-center justify-between w-full px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-colors ${
                    isOnceDailySelected
                      ? "border-white/25 bg-white/8 rounded-b-none border-b-0"
                      : "border-white/8 bg-white/4 hover:border-white/16"
                  }`}
                >
                  <span className={`text-sm font-medium ${isOnceDailySelected ? "text-white" : "text-white/70"}`}>
                    {t("settings.scheduleOnceADay")}
                  </span>
                  {isOnceDailySelected && (
                    <span className="text-xs text-white/60 ml-2 shrink-0 font-mono">
                      {hourLabel12(dailyHour)}:{String(dailyMinute).padStart(2, "0")}
                    </span>
                  )}
                </button>

                {isOnceDailySelected && (
                  <div className="border border-white/25 border-t-0 rounded-xl rounded-t-none bg-white/4 px-3 pt-3 pb-3 flex flex-col gap-3">
                    {/* Hours grid: AM top row, PM bottom row */}
                    <div>
                      <p className="text-[10px] text-white/50 uppercase tracking-widest mb-1.5">Hour</p>
                      <div className="grid grid-cols-12 gap-1">
                        {ALL_HOURS.map(h => (
                          <button
                            key={h}
                            onClick={() => handleDailyHour(h)}
                            className={`py-1 rounded text-[10px] font-medium cursor-pointer transition-colors border ${
                              h === dailyHour
                                ? "bg-white/20 border-white/30 text-white"
                                : "bg-white/4 border-white/8 text-white/60 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            {hourLabel12(h)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Minutes */}
                    <div>
                      <p className="text-[10px] text-white/50 uppercase tracking-widest mb-1.5">Minute</p>
                      <div className="grid grid-cols-12 gap-1">
                        {ALL_MINUTES.map(m => (
                          <button
                            key={m}
                            onClick={() => handleDailyMinute(m)}
                            className={`py-1 rounded text-[10px] font-medium cursor-pointer transition-colors border ${
                              m === dailyMinute
                                ? "bg-white/20 border-white/30 text-white"
                                : "bg-white/4 border-white/8 text-white/60 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            :{String(m).padStart(2, "0")}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {!BASIC_CRONS.has(cron) && !isOnceDailyCron(cron) && (
                <div className="mt-1 px-3 py-2 rounded-xl border border-amber-600/30 bg-amber-900/10 text-xs text-amber-400">
                  {t("settings.scheduleCustomActive")}
                </div>
              )}
            </div>
          ) : (
            <CronScheduler value={cron} onChange={handleCronChange} />
          )}
        </section>

        {/* ── App ───────────────────────────────────────────────────────── */}
        <section>
          <SectionHeader>{t("settings.sectionApp")}</SectionHeader>
          <div className="bg-white/4 rounded-2xl border border-white/8 divide-y divide-white/6">
            <div className="flex items-center justify-between px-4 py-3.5">
              <div>
                <p className="text-sm font-medium text-white">{t(`settings.${getOSStartLabel()}`)}</p>
                <p className="text-xs text-white/60 mt-0.5">{t("settings.startWithWindowsDesc")}</p>
              </div>
              <Toggle enabled={startOnLogin} onChange={handleStartOnLoginToggle} />
            </div>
          </div>
        </section>

        {/* ── Language ──────────────────────────────────────────────────── */}
        <section>
          <SectionHeader>{t("settings.sectionLanguage")}</SectionHeader>
          <div className="bg-white/4 rounded-2xl border border-white/8 p-4">
            <div className="flex gap-2 flex-wrap">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageChange(lang.code)}
                  className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all cursor-pointer ${
                    i18n.language === lang.code
                      ? "border-white/25 bg-white/10 text-white"
                      : "border-white/8 bg-white/4 text-white/60 hover:border-white/18 hover:text-white"
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── API Key ───────────────────────────────────────────────────── */}
        <section>
          <SectionHeader>{t("settings.sectionApiKey")}</SectionHeader>
          <div className="flex flex-col gap-2 bg-white/4 rounded-2xl border border-white/8 p-4">
            <p className="text-xs text-white/60">{t("settings.apiKeyDesc")}</p>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setApiKeyError(null); }}
              onKeyDown={(e) => e.key === "Enter" && apiKey.trim() !== apiKeyLoaded && handleSaveApiKey()}
              placeholder={t("settings.apiKeyPlaceholder")}
              className="w-full bg-white/6 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/50 outline-none focus:border-white/30 transition-colors font-mono"
            />
            {apiKeyError && (
              <p className="text-xs text-red-400">{apiKeyError}</p>
            )}
            <div className="flex items-center justify-between">
              {apiKeySaved && <span className="text-xs text-emerald-400">{t("settings.saved")}</span>}
              <button
                onClick={handleSaveApiKey}
                disabled={apiKeyVerifying || !apiKey.trim() || apiKey.trim() === apiKeyLoaded}
                className="ml-auto text-sm px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/16 border border-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
              >
                {apiKeyVerifying ? t("apiSetup.verifying") : t("settings.apiKeySave")}
              </button>
            </div>
          </div>
        </section>

        {/* ── Support ───────────────────────────────────────────────────── */}
        <section className="pb-2">
          <SectionHeader>Support</SectionHeader>
          <button
            onClick={() => openUrl(BMC_URL)}
            className="w-full flex items-center justify-center gap-2.5 py-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/6 hover:bg-yellow-500/12 hover:border-yellow-500/35 text-yellow-300/80 hover:text-yellow-200 transition-all cursor-pointer"
          >
            <span className="text-lg leading-none">☕</span>
            <span className="text-sm font-medium">Buy me a coffee</span>
          </button>
        </section>

      </div>
      </div>
      </div>
    </div>
  );
}
