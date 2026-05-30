import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { View } from "./types";
import Sidebar from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import ApiKeySetup from "./components/ApiKeySetup";
import HomeView from "./views/HomeView";
import CollectionsView from "./views/CollectionsView";
import UsersView from "./views/UsersView";
import TopicsView from "./views/TopicsView";
import QueriesView from "./views/QueriesView";
import ColorsView from "./views/ColorsView";
import RelatedView from "./views/RelatedView";
import SettingsView from "./views/SettingsView";

export default function App() {
  const [view, setView] = useState<View>("home");
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [wallpaperBg, setWallpaperBg] = useState<string | null>(null);

  useEffect(() => {
    invoke<string | null>("get_api_key")
      .then((key) => setHasApiKey(key !== null))
      .catch(() => setHasApiKey(false));
  }, []);

  useEffect(() => {
    invoke<{ path: string } | null>("get_current_wallpaper")
      .then((info) => {
        if (info?.path) setWallpaperBg(convertFileSrc(info.path));
      })
      .catch(() => {});

    const unlisten = listen("wallpaper-changed", () => {
      invoke<{ path: string } | null>("get_current_wallpaper")
        .then((info) => {
          if (info?.path) setWallpaperBg(convertFileSrc(info.path));
        })
        .catch(() => {});
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [refreshKey] = useState(0);

  const handleRefresh = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await invoke<string>("refresh_wallpaper");
      setStatus(res);
      setIsError(false);
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : String(e));
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  const navigate = (v: View) => {
    if (v !== view) {
      setView(v);
      setStatus(null);
      setIsError(false);
    }
  };

  if (hasApiKey === null) {
    return <div className="h-screen" style={{ background: "#07080e" }} />;
  }

  if (!hasApiKey) {
    return <ApiKeySetup onKeySet={() => setHasApiKey(true)} />;
  }

  return (
    <div
      className="flex flex-col h-screen text-white overflow-hidden select-none relative"
    >
      {/* Blurred wallpaper background */}
      {wallpaperBg && (
        <div
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage: `url(${wallpaperBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(8px) brightness(0.5)",
            transform: "scale(1.05)",
          }}
        />
      )}
      {!wallpaperBg && <div className="absolute inset-0 -z-10" style={{ background: "#07080e" }} />}
      {!navigator.userAgent.includes("Mac") && <TitleBar />}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar view={view} onNavigate={navigate} />

        <div key={view} className="flex-1 flex flex-col min-w-0 animate-view-in">
          {view === "home" && (
            <HomeView onRefresh={handleRefresh} loading={loading} status={status} isError={isError} />
          )}
          {view === "collections" && <CollectionsView refreshKey={refreshKey} />}
          {view === "users" && <UsersView refreshKey={refreshKey} />}
          {view === "topics" && <TopicsView refreshKey={refreshKey} />}
          {view === "queries" && <QueriesView refreshKey={refreshKey} />}
          {view === "colors" && <ColorsView refreshKey={refreshKey} />}
          {view === "related" && <RelatedView refreshKey={refreshKey} />}
          {view === "settings" && <SettingsView onApiKeyChange={() => {}} />}
        </div>
      </div>
    </div>
  );
}
