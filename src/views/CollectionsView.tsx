import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { CollectionSummary } from "../types";
import { IconCollections, IconTrash } from "../components/icons";
import Toggle from "../components/Toggle";
import FilterBar from "../components/FilterBar";

export default function CollectionsView({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useTranslation();
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importId, setImportId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CollectionSummary | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortBy, setSortBy] = useState("date_added");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const SORT_OPTIONS = [
    { value: "date_added", label: t("collections.sortDateAdded") },
    { value: "name",       label: t("collections.sortName") },
    { value: "photos",     label: t("collections.sortPhotos") },
  ];

  const orderMap = useMemo(
    () => new Map(collections.map((c, i) => [c.id, i])),
    [collections]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<CollectionSummary[]>("list_collections");
      setCollections(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleImport = async () => {
    const id = importId.trim();
    if (!id) return;
    setImporting(true);
    setError(null);
    try {
      await invoke<CollectionSummary>("import_collection", { id });
      setImportId("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const confirmAndDelete = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    setCollections((prev) => prev.filter((c) => c.id !== id));
    try {
      await invoke("delete_collection", { id });
    } catch (e) {
      setError(String(e));
      await load();
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)));
    try {
      await invoke("toggle_collection", { id, enabled });
    } catch (e) {
      setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !enabled } : c)));
      setError(String(e));
    }
  };

  const displayed = useMemo(() => {
    let items = collections
      .filter((c) => filter === "all" ? true : filter === "enabled" ? c.enabled : !c.enabled)
      .filter((c) => !search || c.title.toLowerCase().includes(search.toLowerCase()));

    items.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "date_added") cmp = (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0);
      else if (sortBy === "name")   cmp = a.title.localeCompare(b.title);
      else if (sortBy === "photos") cmp = a.count - b.count;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return items;
  }, [collections, filter, search, sortBy, sortDir, orderMap]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6">
      <button
        onClick={() => openUrl("https://unsplash.com/collections")}
        className="text-lg font-semibold text-white mb-4 hover:text-white/70 transition-colors cursor-pointer block"
      >
        {t("collections.title")}
      </button>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={importId}
          onChange={(e) => setImportId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleImport()}
          placeholder={t("collections.placeholder")}
          className="flex-1 bg-white/6 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 transition-colors"
        />
        <button
          onClick={handleImport}
          disabled={importing || !importId.trim()}
          className="text-sm px-4 py-2 rounded-lg bg-white/10 hover:bg-white/16 border border-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
        >
          {importing ? t("collections.importing") : t("common.import")}
        </button>
      </div>

      <FilterBar
        search={search} onSearch={setSearch}
        filter={filter} onFilter={setFilter}
        sortBy={sortBy} onSortBy={setSortBy}
        sortDir={sortDir} onSortDir={setSortDir}
        sortOptions={SORT_OPTIONS}
        searchPlaceholder={t("collections.searchPlaceholder")}
      />

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-red-900/30 text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-white/30 text-sm text-center py-12">{t("common.loading")}</div>
      ) : collections.length === 0 ? (
        <div className="text-white/30 text-sm text-center py-12">{t("collections.empty")}</div>
      ) : displayed.length === 0 ? (
        <div className="text-white/30 text-sm text-center py-12">{t("collections.noMatch")}</div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {displayed.map((col, idx) => (
            <div
              key={col.id}
              className={`animate-card-in bg-white/5 rounded-2xl overflow-hidden border transition-all hover:scale-[1.01] hover:shadow-lg hover:shadow-black/30 ${
                col.enabled ? "border-white/20" : "border-white/8 hover:border-white/16"
              }`}
              style={{ animationDelay: `${idx * 30}ms` }}
            >
              <button
                onClick={() => handleToggle(col.id, !col.enabled)}
                className="h-32 w-full bg-white/4 overflow-hidden block relative group cursor-pointer"
              >
                {col.cover_url ? (
                  <img src={col.cover_url} alt={col.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <IconCollections className="w-10 h-10 text-white/20" />
                  </div>
                )}
                <div className={`absolute inset-0 transition-opacity ${col.enabled ? "bg-white/5 opacity-0 group-hover:opacity-100" : "bg-black/30 opacity-100 group-hover:opacity-60"}`} />
              </button>

              <div className="p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <button
                    onClick={() => openUrl(`https://unsplash.com/collections/${col.id}`)}
                    className="font-semibold text-white text-sm leading-snug truncate hover:text-white/70 transition-colors cursor-pointer text-left"
                    title="Open collection on Unsplash"
                  >
                    {col.title}
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setConfirmDelete(col)}
                      className="p-1 rounded-md text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                      title="Delete collection"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                    <Toggle enabled={col.enabled} onChange={(v) => handleToggle(col.id, v)} />
                  </div>
                </div>
                {col.author_name && (
                  col.author_username ? (
                    <button
                      onClick={() => openUrl(`https://unsplash.com/@${col.author_username}`)}
                      className="text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                    >
                      {t("collections.by", { name: col.author_name })}
                    </button>
                  ) : (
                    <span className="text-xs text-white/40">{t("collections.by", { name: col.author_name })}</span>
                  )
                )}
                <span className="text-[11px] text-white/30 block">{t("collections.photos", { count: col.count })}</span>
                {col.description && (
                  <p className="text-xs text-white/30 leading-relaxed mt-1 line-clamp-2">{col.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#0f1117] border border-white/10 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-white font-semibold mb-2">{t("collections.deleteTitle")}</h3>
            <p className="text-white/50 text-sm mb-6">
              {t("collections.deleteBody", { title: confirmDelete.title })}
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
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
