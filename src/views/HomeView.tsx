import { useState, useEffect, useCallback, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { AdjacentWallpapers, CurrentWallpaperInfo } from "../types";
import { IconRefresh } from "../components/icons";
import ActiveTargetsModal from "../components/ActiveTargetsModal";
import GlassPanel from "../components/GlassPanel";

const STATUS_DURATION_MS = 10_000;
const SAVE_STATUS_DURATION_MS = 5_000;
const BG_TRANSITION_MS = 1000;

interface HomeViewProps {
  onRefresh: () => Promise<void>;
  loading: boolean;
  status: string | null;
  isError: boolean;
}

function AdjacentCard({
  label, info, cacheKey,
}: {
  label: string;
  info: CurrentWallpaperInfo | null;
  cacheKey: number;
}) {
  return (
    <button
      onClick={info ? () => openUrl(info.unsplash_url) : undefined}
      title={info ? `${label} — Photo by ${info.author_name}` : label}
      disabled={!info}
      className="relative flex flex-col overflow-hidden rounded-xl transition-all cursor-pointer text-left shrink-0 disabled:cursor-default"
      style={{ width: 96 }}
    >
      <div className="absolute inset-0 -z-10">
        <GlassPanel cornerRadius={12} className="w-full h-full" />
      </div>
      <div className="relative w-full h-14 overflow-hidden">
        <div className="absolute inset-0 bg-white/5 animate-pulse" />
        {info && (
          <img
            key={`${info.photo_id}-${cacheKey}`}
            src={`${convertFileSrc(info.path)}?t=${cacheKey}`}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ animation: `bg-fade-in ${BG_TRANSITION_MS}ms ease-in-out forwards` }}
          />
        )}
      </div>
      <div className="px-2 py-1">
        <div className="text-[9px] text-white/40 uppercase tracking-wide leading-none mb-0.5">{label}</div>
        {info ? (
          <div className="text-[11px] text-white/80 truncate leading-tight">{info.author_name}</div>
        ) : (
          <div className="h-2 w-14 rounded bg-white/10 animate-pulse mt-1" />
        )}
      </div>
    </button>
  );
}

export default function HomeView({ onRefresh, loading, status, isError }: HomeViewProps) {
  const { t } = useTranslation();
  const [wallpaper, setWallpaper] = useState<CurrentWallpaperInfo | null>(null);
  const [adjacent, setAdjacent] = useState<AdjacentWallpapers>({ previous: null, next: null });
  const [cacheKey, setCacheKey] = useState(() => Date.now());
  const [isNextLoading, setIsNextLoading] = useState(false);

  const [bgSrc, setBgSrc] = useState<string | null>(null);
  const [fadingInSrc, setFadingInSrc] = useState<string | null>(null);
  const bgSrcRef = useRef<string | null>(null);
  const bgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveStatusVisible, setSaveStatusVisible] = useState(false);
  const [saveStatusAnimKey, setSaveStatusAnimKey] = useState(0);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [addingRelated, setAddingRelated] = useState(false);
  const [relatedStatus, setRelatedStatus] = useState<string | null>(null);
  const [relatedStatusVisible, setRelatedStatusVisible] = useState(false);
  const [relatedStatusAnimKey, setRelatedStatusAnimKey] = useState(0);
  const relatedStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [statusVisible, setStatusVisible] = useState(false);
  const [statusAnimKey, setStatusAnimKey] = useState(0);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showTargetsModal, setShowTargetsModal] = useState(false);

  useEffect(() => {
    if (!status) { setStatusVisible(false); return; }
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusVisible(true);
    setStatusAnimKey((k) => k + 1);
    statusTimerRef.current = setTimeout(() => setStatusVisible(false), STATUS_DURATION_MS);
    return () => { if (statusTimerRef.current) clearTimeout(statusTimerRef.current); };
  }, [status]);

  useEffect(() => {
    if (!saveStatus) { setSaveStatusVisible(false); return; }
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    setSaveStatusVisible(true);
    setSaveStatusAnimKey((k) => k + 1);
    saveStatusTimerRef.current = setTimeout(() => setSaveStatusVisible(false), SAVE_STATUS_DURATION_MS);
    return () => { if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current); };
  }, [saveStatus]);

  useEffect(() => {
    if (!relatedStatus) { setRelatedStatusVisible(false); return; }
    if (relatedStatusTimerRef.current) clearTimeout(relatedStatusTimerRef.current);
    setRelatedStatusVisible(true);
    setRelatedStatusAnimKey((k) => k + 1);
    relatedStatusTimerRef.current = setTimeout(() => setRelatedStatusVisible(false), SAVE_STATUS_DURATION_MS);
    return () => { if (relatedStatusTimerRef.current) clearTimeout(relatedStatusTimerRef.current); };
  }, [relatedStatus]);

  const imgSrc = wallpaper ? `${convertFileSrc(wallpaper.path)}?t=${cacheKey}` : null;

  useEffect(() => {
    if (!imgSrc) return;
    if (!bgSrcRef.current) {
      bgSrcRef.current = imgSrc;
      setBgSrc(imgSrc);
      return;
    }
    setFadingInSrc(imgSrc);
    if (bgTimerRef.current) clearTimeout(bgTimerRef.current);
    bgTimerRef.current = setTimeout(() => {
      bgSrcRef.current = imgSrc;
      setBgSrc(imgSrc);
      setFadingInSrc(null);
    }, BG_TRANSITION_MS + 100);
    return () => { if (bgTimerRef.current) clearTimeout(bgTimerRef.current); };
  }, [imgSrc]);

  const loadWallpaper = useCallback(async () => {
    try {
      const [info, adj] = await Promise.all([
        invoke<CurrentWallpaperInfo | null>("get_current_wallpaper"),
        invoke<AdjacentWallpapers>("get_adjacent_wallpapers"),
      ]);
      setWallpaper(info);
      setAdjacent(adj);
      setCacheKey(Date.now());
      if (adj.next) setIsNextLoading(false);
    } catch {
      setWallpaper(null);
    }
  }, []);

  useEffect(() => { loadWallpaper(); }, [loadWallpaper]);

  useEffect(() => {
    const unlisten = listen("wallpaper-changed", () => { setIsNextLoading(true); loadWallpaper(); });
    return () => { unlisten.then((fn) => fn()); };
  }, [loadWallpaper]);

  useEffect(() => {
    const unlisten = listen("next-wallpaper-ready", async () => {
      const adj = await invoke<AdjacentWallpapers>("get_adjacent_wallpapers");
      setAdjacent(adj);
      setCacheKey(Date.now());
      setIsNextLoading(false);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleAddRelated = async () => {
    if (!wallpaper) return;
    setAddingRelated(true);
    setRelatedStatus(null);
    try {
      await invoke("import_related_source", { input: wallpaper.unsplash_url });
      setRelatedStatus(t("home.addedToRelated"));
    } catch (e) {
      setRelatedStatus(`Error: ${String(e)}`);
    } finally {
      setAddingRelated(false);
    }
  };

  const handleSave = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Choose folder to save wallpaper" });
    if (!folder) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const savedPath = await invoke<string>("save_wallpaper_to_folder", { folder });
      const filename = savedPath.split(/[\\/]/).pop() ?? savedPath;
      setSaveStatus(t("home.savedAs", { filename }));
    } catch (e) {
      setSaveStatus(`Error: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const hadPreviousRef = useRef(false);
  if (adjacent.previous) hadPreviousRef.current = true;
  const showPrevious = hadPreviousRef.current;
  const showNext = isNextLoading || adjacent.next !== null;

  return (
    <div className="flex-1 relative overflow-hidden">
      {bgSrc && (
        <img src={bgSrc} alt="" className="absolute inset-0 w-full h-full object-cover scale-110" style={{ filter: "blur(16px)" }} />
      )}
      {fadingInSrc && (
        <img
          key={fadingInSrc}
          src={fadingInSrc}
          alt=""
          className="absolute inset-0 w-full h-full object-cover scale-110"
          style={{ filter: "blur(16px)", animation: `bg-fade-in ${BG_TRANSITION_MS}ms ease-in-out forwards` }}
        />
      )}
      <div className="absolute inset-0 bg-slate-900/70" />

      <button
        onClick={() => setShowTargetsModal(true)}
        className="absolute top-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white/80 hover:text-white transition-all cursor-pointer overflow-hidden"
      >
        <div className="absolute inset-0 -z-10">
          <GlassPanel cornerRadius={12} className="w-full h-full" />
        </div>
        {t("home.activeSources")}
      </button>

      <div className="relative z-10 flex flex-col items-center justify-center h-full gap-6 p-8">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="relative flex items-center gap-3 px-8 py-4 rounded-2xl text-base font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 cursor-pointer active:scale-95 overflow-hidden"
        >
          <div className="absolute inset-0 -z-10">
            <GlassPanel cornerRadius={16} className="w-full h-full" />
          </div>
          <IconRefresh className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          {loading ? t("home.refreshing") : t("home.refreshWallpaper")}
        </button>

        {statusVisible && status && (
          <div className={`relative max-w-sm w-full text-center text-sm px-4 py-3 rounded-xl overflow-hidden ${
            isError ? "bg-red-900/40 text-red-300" : "bg-emerald-900/40 text-emerald-300"
          }`}>
            {status}
            <div
              key={statusAnimKey}
              className={`absolute bottom-0 left-0 h-px w-full origin-left ${isError ? "bg-red-400/60" : "bg-emerald-400/60"}`}
              style={{ animation: `status-bar-shrink ${STATUS_DURATION_MS}ms linear forwards` }}
            />
          </div>
        )}
      </div>

      <div className="absolute bottom-5 left-0 right-0 z-10 flex items-end justify-between px-5">
        <div className="flex gap-2">
          {showPrevious && <AdjacentCard label={t("home.previous")} info={adjacent.previous} cacheKey={cacheKey} />}
          {showNext && <AdjacentCard label={t("home.next")} info={adjacent.next} cacheKey={cacheKey} />}
        </div>

        {wallpaper && (
          <div className="flex flex-col items-end gap-2">
            {relatedStatusVisible && relatedStatus && (
              <span className={`relative text-xs px-2 py-1 rounded-lg overflow-hidden ${
                relatedStatus.startsWith("Error") ? "bg-red-900/50 text-red-300" : "bg-emerald-900/50 text-emerald-300"
              }`}>
                {relatedStatus}
                <span key={relatedStatusAnimKey} className={`absolute bottom-0 left-0 h-px w-full origin-left ${relatedStatus.startsWith("Error") ? "bg-red-400/60" : "bg-emerald-400/60"}`}
                  style={{ animation: `status-bar-shrink ${SAVE_STATUS_DURATION_MS}ms linear forwards` }} />
              </span>
            )}
            {saveStatusVisible && saveStatus && (
              <span className={`relative text-xs px-2 py-1 rounded-lg overflow-hidden ${
                saveStatus.startsWith("Error") ? "bg-red-900/50 text-red-300" : "bg-emerald-900/50 text-emerald-300"
              }`}>
                {saveStatus}
                <span key={saveStatusAnimKey} className={`absolute bottom-0 left-0 h-px w-full origin-left ${saveStatus.startsWith("Error") ? "bg-red-400/60" : "bg-emerald-400/60"}`}
                  style={{ animation: `status-bar-shrink ${SAVE_STATUS_DURATION_MS}ms linear forwards` }} />
              </span>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleAddRelated}
                disabled={addingRelated}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addingRelated ? t("home.adding") : t("home.addToRelated")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? t("home.saving") : t("home.saveToFolder")}
              </button>
            </div>
            <button
              onClick={() => openUrl(wallpaper.unsplash_url)}
              className="text-xs text-white/70 hover:text-white transition-colors cursor-pointer"
            >
              {t("home.photoBy", { name: wallpaper.author_name })}
            </button>
          </div>
        )}
      </div>

      {showTargetsModal && <ActiveTargetsModal onClose={() => setShowTargetsModal(false)} />}
    </div>
  );
}
