import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { UserSummary } from "../types";
import { IconTrash } from "../components/icons";
import Toggle from "../components/Toggle";
import FilterBar from "../components/FilterBar";

export default function UsersView({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserSummary | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortBy, setSortBy] = useState("date_added");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const SORT_OPTIONS = [
    { value: "date_added", label: t("users.sortDateAdded") },
    { value: "username",   label: t("users.sortUsername") },
    { value: "photos",     label: t("users.sortPhotos") },
  ];

  const orderMap = useMemo(
    () => new Map(users.map((u, i) => [u.username, i])),
    [users]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<UserSummary[]>("list_users");
      setUsers(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleFollow = async () => {
    const u = username.trim();
    if (!u) return;
    setFollowing(true);
    setError(null);
    try {
      await invoke<UserSummary>("follow_user", { username: u });
      setUsername("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setFollowing(false);
    }
  };

  const handleToggle = async (uname: string, enabled: boolean) => {
    setUsers((prev) => prev.map((u) => (u.username === uname ? { ...u, enabled } : u)));
    try {
      await invoke("toggle_user", { username: uname, enabled });
    } catch (e) {
      setUsers((prev) => prev.map((u) => (u.username === uname ? { ...u, enabled: !enabled } : u)));
      setError(String(e));
    }
  };

  const confirmAndDelete = async () => {
    if (!confirmDelete) return;
    const uname = confirmDelete.username;
    setConfirmDelete(null);
    setUsers((prev) => prev.filter((u) => u.username !== uname));
    try {
      await invoke("delete_user", { username: uname });
    } catch (e) {
      setError(String(e));
      await load();
    }
  };

  const displayed = useMemo(() => {
    let items = users
      .filter((u) => filter === "all" ? true : filter === "enabled" ? u.enabled : !u.enabled)
      .filter((u) => !search || u.username.toLowerCase().includes(search.toLowerCase()));

    items.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "date_added")  cmp = (orderMap.get(a.username) ?? 0) - (orderMap.get(b.username) ?? 0);
      else if (sortBy === "username") cmp = a.username.localeCompare(b.username);
      else if (sortBy === "photos")   cmp = a.total_photos - b.total_photos;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return items;
  }, [users, filter, search, sortBy, sortDir, orderMap]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6">
      <h2 className="text-lg font-semibold text-white mb-4">{t("users.title")}</h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleFollow()}
          placeholder={t("users.placeholder")}
          className="flex-1 bg-white/6 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/50 outline-none focus:border-white/30 transition-colors"
        />
        <button
          onClick={handleFollow}
          disabled={following || !username.trim()}
          className="text-sm px-4 py-2 rounded-lg bg-white/10 hover:bg-white/16 border border-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
        >
          {following ? t("users.following") : t("users.follow")}
        </button>
      </div>

      <FilterBar
        search={search} onSearch={setSearch}
        filter={filter} onFilter={setFilter}
        sortBy={sortBy} onSortBy={setSortBy}
        sortDir={sortDir} onSortDir={setSortDir}
        sortOptions={SORT_OPTIONS}
        searchPlaceholder={t("users.searchPlaceholder")}
      />

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-red-900/30 text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-white/50 text-sm text-center py-12">{t("common.loading")}</div>
      ) : users.length === 0 ? (
        <div className="text-white/50 text-sm text-center py-12">{t("users.empty")}</div>
      ) : displayed.length === 0 ? (
        <div className="text-white/50 text-sm text-center py-12">{t("users.noMatch")}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {displayed.map((user, idx) => (
            <div
              key={user.username}
              onClick={() => handleToggle(user.username, !user.enabled)}
              className={`animate-card-in bg-white/5 rounded-2xl p-4 border transition-all hover:shadow-md hover:shadow-black/20 flex items-center gap-4 cursor-pointer ${
                user.enabled ? "border-white/20" : "border-white/8 hover:border-white/16"
              }`}
              style={{ animationDelay: `${idx * 25}ms` }}
            >
              <div className="w-12 h-12 rounded-full overflow-hidden bg-white/8 border border-white/12 shrink-0 flex items-center justify-center">
                {user.avatar_path ? (
                  <img src={convertFileSrc(user.avatar_path)} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white/60 font-semibold text-sm">{user.name.charAt(0).toUpperCase()}</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <button
                  onClick={(e) => { e.stopPropagation(); openUrl(`https://unsplash.com/@${user.username}`); }}
                  className="font-semibold text-white text-sm hover:text-white/70 transition-colors cursor-pointer block"
                >
                  {user.name}
                </button>
                <p className="text-xs text-white/50">@{user.username}</p>
                {user.bio && <p className="text-xs text-white/50 mt-1 truncate">{user.bio}</p>}
              </div>

              <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-white/50">{t("users.photos", { count: user.total_photos })}</span>
                <button
                  onClick={() => setConfirmDelete(user)}
                  className="p-1 rounded-md text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                  title="Unfollow photographer"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
                <Toggle enabled={user.enabled} onChange={(v) => handleToggle(user.username, v)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-md z-50 flex items-center justify-center p-6 modal-backdrop-in"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
        >
          <div className="w-full max-w-sm">
            <div className="relative rounded-3xl overflow-hidden border border-white/[0.12] shadow-2xl shadow-black/40">
              {/* Emulated liquid glass */}
              <div className="absolute inset-0 z-0 pointer-events-none backdrop-blur-2xl bg-white/[0.04]" />
              <div className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-br from-white/[0.08] via-transparent to-white/[0.03]" />
              <div className="absolute inset-0 z-0 pointer-events-none bg-black/35" />

              <div className="relative z-[2] p-6">
                <h3 className="text-white font-semibold mb-2">{t("users.unfollowTitle")}</h3>
                <p className="text-white/70 text-sm mb-6">
                  {t("users.unfollowBody", { name: confirmDelete.name, username: confirmDelete.username })}
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
                    {t("users.unfollow")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
