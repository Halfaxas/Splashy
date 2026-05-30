import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { TopicWithEnabled } from "../types";
import { IconTopics } from "../components/icons";
import Toggle from "../components/Toggle";
import FilterBar from "../components/FilterBar";

export default function TopicsView({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useTranslation();
  const [topics, setTopics] = useState<TopicWithEnabled[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const SORT_OPTIONS = [
    { value: "name",   label: t("topics.sortName") },
    { value: "photos", label: t("topics.sortPhotos") },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<TopicWithEnabled[]>("list_topics");
      setTopics(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleToggle = async (id: string, slug: string, enabled: boolean) => {
    setTopics((prev) => prev.map((t) => (t.slug === slug ? { ...t, enabled } : t)));
    try {
      await invoke("toggle_topic", { topicId: id, enabled });
    } catch (e) {
      setTopics((prev) => prev.map((t) => (t.slug === slug ? { ...t, enabled: !enabled } : t)));
      setError(String(e));
    }
  };

  const displayed = useMemo(() => {
    let items = topics
      .filter((t) => filter === "all" ? true : filter === "enabled" ? t.enabled : !t.enabled)
      .filter((t) => !search || t.title.toLowerCase().includes(search.toLowerCase()));

    items.sort((a, b) => {
      const cmp = sortBy === "photos" ? a.total_photos - b.total_photos : a.title.localeCompare(b.title);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return items;
  }, [topics, filter, search, sortBy, sortDir]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6">
      <h2 className="text-lg font-semibold text-white mb-4">{t("topics.title")}</h2>

      <FilterBar
        search={search} onSearch={setSearch}
        filter={filter} onFilter={setFilter}
        sortBy={sortBy} onSortBy={setSortBy}
        sortDir={sortDir} onSortDir={setSortDir}
        sortOptions={SORT_OPTIONS}
        searchPlaceholder={t("topics.searchPlaceholder")}
      />

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-red-900/30 text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-white/50 text-sm text-center py-12">{t("common.loading")}</div>
      ) : topics.length === 0 ? (
        <div className="text-white/50 text-sm text-center py-12">{t("topics.empty")}</div>
      ) : displayed.length === 0 ? (
        <div className="text-white/50 text-sm text-center py-12">{t("topics.noMatch")}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {displayed.map((topic, idx) => (
            <button
              key={topic.id}
              onClick={() => handleToggle(topic.id, topic.slug, !topic.enabled)}
              className={`animate-card-in bg-white/5 rounded-2xl overflow-hidden border transition-all hover:scale-[1.01] hover:shadow-lg hover:shadow-black/30 cursor-pointer text-left w-full ${
                topic.enabled ? "border-white/20" : "border-white/8 hover:border-white/16"
              }`}
              style={{ animationDelay: `${idx * 25}ms` }}
            >
              <div className="h-24 bg-white/4 flex items-center justify-center overflow-hidden">
                {topic.cover_url ? (
                  <img src={topic.cover_url} alt={topic.title} className="w-full h-full object-cover" />
                ) : (
                  <IconTopics className="w-8 h-8 text-white/20" />
                )}
              </div>
              <div className="p-3 flex items-center justify-between">
                <div className="min-w-0 mr-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); openUrl(`https://unsplash.com/t/${topic.slug}`); }}
                    className="text-sm font-medium text-white hover:text-white/70 transition-colors cursor-pointer truncate block text-left"
                  >
                    {topic.title}
                  </button>
                  <span className="text-xs text-white/50 pointer-events-none">{topic.total_photos.toLocaleString()} {t("topics.sortPhotos").toLowerCase()}</span>
                </div>
                <span className="pointer-events-none">
                  <Toggle enabled={topic.enabled} onChange={() => {}} />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
