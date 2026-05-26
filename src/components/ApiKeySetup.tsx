import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";

interface Props {
  onKeySet: () => void;
}

export default function ApiKeySetup({ onKeySet }: Props) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("verify_and_save_api_key", { key: trimmed });
      onKeySet();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#07080e" }}>
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 text-center">
          <div className="text-4xl mb-4">🔑</div>
          <h1 className="text-xl font-semibold text-white mb-2">{t("apiSetup.title")}</h1>
          <p className="text-sm text-white/50 leading-relaxed">{t("apiSetup.description")}</p>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            placeholder={t("apiSetup.placeholder")}
            autoFocus
            className="w-full bg-white/6 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 transition-colors font-mono"
          />

          {error && (
            <div className="text-sm px-3 py-2 rounded-lg bg-red-900/30 text-red-300">{error}</div>
          )}

          <button
            onClick={handleVerify}
            disabled={loading || !key.trim()}
            className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/16 border border-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors cursor-pointer"
          >
            {loading ? t("apiSetup.verifying") : t("apiSetup.verify")}
          </button>

          <button
            onClick={() => openUrl("https://unsplash.com/developers")}
            className="text-xs text-white/30 hover:text-white/60 transition-colors cursor-pointer text-center mt-1"
          >
            {t("apiSetup.getKey")}
          </button>
        </div>
      </div>
    </div>
  );
}
