import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { QuerySummary } from "../types";
import { IconSearch, IconTrash } from "../components/icons";
import Toggle from "../components/Toggle";
import FilterBar from "../components/FilterBar";

export default function QueriesView({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useTranslation();
  const [queries, setQueries] = useState<QuerySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<QuerySummary | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortBy, setSortBy] = useState("date_added");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const SORT_OPTIONS = [
    { value: "date_added", label: t("queries.sortDateAdded") },
    { value: "name",       label: t("queries.sortName") },
  ];

  const orderMap = useMemo(
    () => new Map(queries.map((q, i) => [q.id, i])),
    [queries]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<QuerySummary[]>("list_queries");
      setQueries(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleAdd = async () => {
    const q = input.trim();
    if (!q) return;
    setAdding(true);
    setError(null);
    try {
      await invoke<QuerySummary>("add_query", { query: q });
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
    const id = confirmDelete.id;
    setConfirmDelete(null);
    setQueries((prev) => prev.filter((q) => q.id !== id));
    try {
      await invoke("delete_query", { id });
    } catch (e) {
      setError(String(e));
      await load();
    }
  };

  const displayed = useMemo(() => {
    let items = queries
      .filter((q) => filter === "all" ? true : filter === "enabled" ? q.enabled : !q.enabled)
      .filter((q) => !search || q.value.toLowerCase().includes(search.toLowerCase()));

    items.sort((a, b) => {
      const cmp = sortBy === "name"
        ? a.value.localeCompare(b.value)
        : (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return items;
  }, [queries, filter, search, sortBy, sortDir, orderMap]);

  const handleToggle = async (id: string, enabled: boolean) => {
    setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, enabled } : q)));
    try {
      await invoke("toggle_query", { id, enabled });
    } catch (e) {
      setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, enabled: !enabled } : q)));
      setError(String(e));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6">
      <h2 className="text-lg font-semibold text-white mb-1">{t("queries.title")}</h2>
      <p className="text-sm text-white/60 mb-4">{t("queries.desc")}</p>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={t("queries.placeholder")}
          maxLength={64}
          className="flex-1 bg-white/6 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/50 outline-none focus:border-white/30 transition-colors"
        />
        <button
          onClick={handleAdd}
          disabled={adding || !input.trim()}
          className="text-sm px-4 py-2 rounded-lg bg-white/10 hover:bg-white/16 border border-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
        >
          {adding ? t("queries.adding") : t("common.add")}
        </button>
      </div>

      <FilterBar
        search={search} onSearch={setSearch}
        filter={filter} onFilter={setFilter}
        sortBy={sortBy} onSortBy={setSortBy}
        sortDir={sortDir} onSortDir={setSortDir}
        sortOptions={SORT_OPTIONS}
        searchPlaceholder={t("queries.searchPlaceholder")}
      />

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-red-900/30 text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-white/50 text-sm text-center py-12">{t("common.loading")}</div>
      ) : queries.length === 0 ? (
        <div className="text-white/50 text-sm text-center py-12">{t("queries.empty")}</div>
      ) : displayed.length === 0 ? (
        <div className="text-white/50 text-sm text-center py-12">{t("queries.noMatch")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {displayed.map((q, idx) => (
            <div
              key={q.id}
              onClick={() => handleToggle(q.id, !q.enabled)}
              className={`animate-card-in flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:shadow-md hover:shadow-black/20 cursor-pointer ${
                q.enabled
                  ? "bg-white/6 border-white/20"
                  : "bg-white/4 border-white/8"
              }`}
              style={{ animationDelay: `${idx * 20}ms` }}
            >
              <IconSearch className="w-4 h-4 text-white/50 shrink-0 pointer-events-none" />
              <button
                onClick={(e) => { e.stopPropagation(); openUrl(`https://unsplash.com/s/photos/${encodeURIComponent(q.value)}`); }}
                className="min-w-0 shrink text-sm text-white font-medium truncate text-left hover:text-white/70 transition-colors cursor-pointer"
              >
                {q.value}
              </button>
              <div className="flex-1" />
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(q); }}
                className="p-1 rounded-md text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                title="Delete query"
              >
                <IconTrash className="w-3.5 h-3.5" />
              </button>
              <span onClick={(e) => e.stopPropagation()}>
                <Toggle enabled={q.enabled} onChange={(v) => handleToggle(q.id, v)} />
              </span>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#0f1117] border border-white/10 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-white font-semibold mb-2">{t("queries.deleteTitle")}</h3>
            <p className="text-white/70 text-sm mb-6">
              {t("queries.deleteBody", { value: confirmDelete.value })}
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
    </div>
  );
}
