import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { ColorSource } from "../types";
import Toggle from "../components/Toggle";
import GlassPanel from "../components/GlassPanel";

const COLOR_META: Record<string, { hex: string; ring: string }> = {
  black:   { hex: "#111111", ring: "#555555" },
  white:   { hex: "#e8e8e8", ring: "#cccccc" },
  yellow:  { hex: "#facc15", ring: "#facc15" },
  orange:  { hex: "#f97316", ring: "#f97316" },
  red:     { hex: "#ef4444", ring: "#ef4444" },
  purple:  { hex: "#a855f7", ring: "#a855f7" },
  magenta: { hex: "#e879f9", ring: "#e879f9" },
  green:   { hex: "#22c55e", ring: "#22c55e" },
  teal:    { hex: "#14b8a6", ring: "#14b8a6" },
  blue:    { hex: "#3b82f6", ring: "#3b82f6" },
};

export default function ColorsView({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useTranslation();
  const [colors, setColors] = useState<ColorSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<ColorSource[]>("list_colors");
      setColors(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleToggle = async (color: string, enabled: boolean) => {
    setColors((prev) => prev.map((c) => (c.color === color ? { ...c, enabled } : c)));
    try {
      await invoke("toggle_color", { color, enabled });
    } catch (e) {
      setColors((prev) => prev.map((c) => (c.color === color ? { ...c, enabled: !enabled } : c)));
      setError(String(e));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto relative">
      <div className="absolute inset-0 z-0 m-3">
        <GlassPanel className="w-full h-full" />
      </div>
      <div className="relative z-10 p-6">
      <h2 className="text-lg font-semibold text-white mb-1">{t("colors.title")}</h2>
      <p className="text-sm text-white/40 mb-6">{t("colors.desc")}</p>

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-red-900/30 text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-white/30 text-sm text-center py-12">{t("common.loading")}</div>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {colors.map(({ color, enabled }, idx) => {
            const meta = COLOR_META[color] ?? { hex: "#888", ring: "#888" };
            return (
              <button
                key={color}
                onClick={() => handleToggle(color, !enabled)}
                className="animate-card-in rounded-2xl overflow-hidden border-2 transition-all duration-150 hover:scale-[1.03] hover:shadow-lg cursor-pointer text-left w-full"
                style={{
                  animationDelay: `${idx * 30}ms`,
                  borderColor: enabled ? meta.ring : "transparent",
                  boxShadow: enabled ? `0 0 0 1px ${meta.ring}33` : undefined,
                }}
              >
                <div className="h-24 w-full" style={{ backgroundColor: meta.hex }} />
                <div className="bg-white/5 flex items-center justify-center py-2.5 pointer-events-none">
                  <Toggle enabled={enabled} onChange={() => {}} />
                </div>
              </button>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
