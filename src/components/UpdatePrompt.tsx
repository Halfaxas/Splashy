import { useEffect, useState, useCallback, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";
import { IconDownload } from "./icons";

type Phase = "prompt" | "downloading" | "installing" | "error";

const CLOSE_DURATION = 160;

export default function UpdatePrompt() {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>("prompt");
  const [progress, setProgress] = useState(0);
  const [closing, setClosing] = useState(false);
  const totalBytesRef = useRef(0);
  const downloadedBytesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    check().then(setUpdate).catch(() => {});
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const dismiss = useCallback(() => {
    if (closing) return;
    setClosing(true);
    timerRef.current = setTimeout(() => {
      update?.close();
      setUpdate(null);
    }, CLOSE_DURATION);
  }, [closing, update]);

  const handleInstall = async () => {
    if (!update) return;
    setPhase("downloading");
    setProgress(0);
    totalBytesRef.current = 0;
    downloadedBytesRef.current = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytesRef.current = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloadedBytesRef.current += event.data.chunkLength;
          if (totalBytesRef.current > 0) {
            setProgress(Math.min(100, (downloadedBytesRef.current / totalBytesRef.current) * 100));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
          setPhase("installing");
        }
      });
      // Windows exits the process from inside downloadAndInstall — this only
      // runs on macOS/Linux, where the new version needs an explicit restart.
      await relaunch();
    } catch {
      setPhase("error");
    }
  };

  if (!update) return null;

  return (
    <div
      className={`fixed inset-0 bg-black/40 backdrop-blur-md z-70 flex items-center justify-center p-6 ${
        closing ? "modal-backdrop-out" : "modal-backdrop-in"
      }`}
    >
      <div className={`w-full max-w-sm transition-opacity duration-200 ${closing ? "opacity-0" : "opacity-100"}`}>
        <div className="relative rounded-3xl overflow-hidden border border-white/[0.12] shadow-2xl shadow-black/40">
          {/* Emulated liquid glass — backdrop blur + layered gradients */}
          <div className="absolute inset-0 z-0 pointer-events-none backdrop-blur-2xl bg-white/[0.04]" />
          <div className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-br from-white/[0.08] via-transparent to-white/[0.03]" />
          <div className="absolute inset-0 z-0 pointer-events-none bg-black/35" />

          <div className="relative z-[2] px-6 py-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-emerald-400/12 border border-emerald-400/28 shrink-0">
                <IconDownload className="w-4.5 h-4.5 text-emerald-300" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-white tracking-tight">{t("updater.title")}</h2>
                <p className="text-xs text-white/40 mt-0.5 truncate">
                  {t("updater.subtitle", { version: update.version })}
                </p>
              </div>
            </div>

            {update.body && phase === "prompt" && (
              <p className="text-xs text-white/50 leading-relaxed max-h-28 overflow-y-auto whitespace-pre-line mb-5 px-0.5">
                {update.body}
              </p>
            )}

            {(phase === "downloading" || phase === "installing") && (
              <div className="mb-5">
                <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400/70 transition-[width] duration-200 ease-out"
                    style={{ width: `${phase === "installing" ? 100 : progress}%` }}
                  />
                </div>
                <p className="text-[11px] text-white/35 mt-2">
                  {phase === "installing" ? t("updater.installing") : t("updater.downloading")}
                </p>
              </div>
            )}

            {phase === "error" && (
              <p className="text-xs text-red-300/80 mb-5">{t("updater.error")}</p>
            )}

            <div className="flex items-center justify-end gap-2">
              {(phase === "prompt" || phase === "error") && (
                <button
                  onClick={dismiss}
                  className="text-[13px] font-medium px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/80 border border-white/8 transition-all cursor-pointer"
                >
                  {t("updater.later")}
                </button>
              )}
              <button
                onClick={handleInstall}
                disabled={phase === "downloading" || phase === "installing"}
                className="text-[13px] font-medium px-4 py-2 rounded-full bg-emerald-400/15 hover:bg-emerald-400/22 text-emerald-300 border border-emerald-400/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {phase === "downloading"
                  ? t("updater.downloading")
                  : phase === "installing"
                  ? t("updater.installing")
                  : t("updater.install")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
