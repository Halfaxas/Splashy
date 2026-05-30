import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { RelatedSourceSummary } from "../types";
import { IconTrash } from "../components/icons";
import Toggle from "../components/Toggle";
import FilterBar from "../components/FilterBar";
import GlassPanel from "../components/GlassPanel";

export default function RelatedView({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<RelatedSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const cacheKeyRef = useRef(Date.now());
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RelatedSourceSummary | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const SORT_OPTIONS = [{ value: "date_added", label: t("related.sortDateAdded") }];

  const orderMap = useMemo(
    () => new Map(sources.map((s, i) => [s.photo_id, i])),
    [sources]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<RelatedSourceSummary[]>("list_related_sources");
      cacheKeyRef.current = Date.now();
      setSources(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleAdd = async () => {
    const val = input.trim();
    if (!val) return;
    setAdding(true);
    setError(null);
    try {
      await invoke<RelatedSourceSummary>("import_related_source", { input: val });
      setInput("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const confirmAndDelete = async () => {
    if (!confirmDelete) return;
    const photoId = confirmDelete.photo_id;
    setConfirmDelete(null);
    setSources((prev) => prev.filter((s) => s.photo_id !== photoId));
    try {
      await invoke("delete_related_source", { photoId });
    } catch (e) {
      setError(String(e));
      await load();
    }
  };

  const handleToggle = async (photoId: string, enabled: boolean) => {
    setSources((prev) => prev.map((s) => (s.photo_id === photoId ? { ...s, enabled } : s)));
    try {
      await invoke("toggle_related_source", { photoId, enabled });
    } catch (e) {
      setSources((prev) => prev.map((s) => (s.photo_id === photoId ? { ...s, enabled: !enabled } : s)));
      setError(String(e));
    }
  };

  const displayed = useMemo(() => {
    let items = sources
      .filter((s) => filter === "all" ? true : filter === "enabled" ? s.enabled : !s.enabled)
      .filter((s) => !search || s.slug.toLowerCase().includes(search.toLowerCase()));

    items.sort((a, b) => {
      const cmp = (orderMap.get(a.photo_id) ?? 0) - (orderMap.get(b.photo_id) ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return items;
  }, [sources, filter, search, sortDir, orderMap]);

  return (
    <div className="flex-1 overflow-y-auto relative">
      <div className="absolute inset-0 z-0 m-3">
        <GlassPanel className="w-full h-full" />
      </div>
      <div className="relative z-10 p-6">
      <h2 className="text-lg font-semibold text-white mb-1">{t("related.title")}</h2>
      <p className="text-sm text-white/40 mb-4">{t("related.desc")}</p>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={t("related.placeholder")}
          className="flex-1 bg-white/6 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 transition-colors"
        />
        <button
          onClick={handleAdd}
          disabled={adding || !input.trim()}
          className="text-sm px-4 py-2 rounded-lg bg-white/10 hover:bg-white/16 border border-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
        >
          {adding ? t("home.adding") : t("common.add")}
        </button>
      </div>

      <FilterBar
        search={search} onSearch={setSearch}
        filter={filter} onFilter={setFilter}
        sortBy="date_added" onSortBy={() => {}}
        sortDir={sortDir} onSortDir={setSortDir}
        sortOptions={SORT_OPTIONS}
        searchPlaceholder={t("related.searchPlaceholder")}
      />

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-red-900/30 text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-white/30 text-sm text-center py-12">{t("common.loading")}</div>
      ) : sources.length === 0 ? (
        <div className="text-white/30 text-sm text-center py-12">{t("related.empty")}</div>
      ) : displayed.length === 0 ? (
        <div className="text-white/30 text-sm text-center py-12">{t("related.noMatch")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {displayed.map((s, idx) => (
            <div
              key={s.photo_id}
              onClick={() => handleToggle(s.photo_id, !s.enabled)}
              className={`animate-card-in flex items-center gap-3 rounded-xl border overflow-hidden transition-all hover:shadow-md hover:shadow-black/20 cursor-pointer ${
                s.enabled
                  ? "bg-white/6 border-white/20"
                  : "bg-white/4 border-white/8"
              }`}
              style={{ animationDelay: `${idx * 20}ms` }}
            >
              {s.cover_url ? (
                <img
                  src={`${convertFileSrc(s.cover_url)}?t=${cacheKeyRef.current}`}
                  alt=""
                  className="w-16 h-16 object-cover shrink-0 pointer-events-none"
                />
              ) : (
                <div className="w-16 h-16 bg-white/6 shrink-0 flex items-center justify-center pointer-events-none">
                  <span className="text-white/30 text-xs">{t("common.noImg")}</span>
                </div>
              )}

              <div className="flex-1 min-w-0 py-2">
                <button
                  onClick={(e) => { e.stopPropagation(); openUrl(s.unsplash_url); }}
                  className="text-sm font-medium text-white hover:text-white/70 transition-colors cursor-pointer truncate block text-left"
                >
                  {t("related.by", { name: s.author_name })}
                </button>
                <span className="text-xs text-white/30 pointer-events-none">@{s.author_username}</span>
              </div>

              <div className="flex items-center gap-2 pr-4 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(s); }}
                  className="p-1 rounded-md text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                  title="Delete source"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
                <span onClick={(e) => e.stopPropagation()}>
                  <Toggle enabled={s.enabled} onChange={(v) => handleToggle(s.photo_id, v)} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#0f1117] border border-white/10 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-white font-semibold mb-2">{t("related.deleteTitle")}</h3>
            <p className="text-white/50 text-sm mb-6">
              {t("related.deleteBody", { name: confirmDelete.author_name })}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm rounded-lg bg-white/8 hover:bg-white/12 text-white transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={confirmAndDelete}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer"
              >
                {t("related.remove")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
