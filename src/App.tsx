import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { View } from "./types";
import Sidebar from "./components/Sidebar";
import ApiKeySetup from "./components/ApiKeySetup";
import HomeView from "./views/HomeView";
import CollectionsView from "./views/CollectionsView";
import UsersView from "./views/UsersView";
import TopicsView from "./views/TopicsView";
import QueriesView from "./views/QueriesView";
import ColorsView from "./views/ColorsView";
import RelatedView from "./views/RelatedView";
import SettingsView from "./views/SettingsView";

function computeBrightness(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 50;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(0); return; }
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      }
      resolve(total / (size * size));
    };
    img.onerror = () => resolve(0);
    img.src = url;
  });
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [wallpaperBg, setWallpaperBg] = useState<string | null>(null);
  const [fadingBg, setFadingBg] = useState<string | null>(null);
  const [isLightBg, setIsLightBg] = useState(false);
  const bgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateBrightness = useCallback(async (url: string) => {
    const brightness = await computeBrightness(url);
    setIsLightBg(brightness > 140);
  }, []);

  useEffect(() => {
    invoke<string | null>("get_api_key")
      .then((key) => setHasApiKey(key !== null))
      .catch(() => setHasApiKey(false));
  }, []);

  useEffect(() => {
    invoke<{ path: string } | null>("get_current_wallpaper")
      .then((info) => {
        if (info?.path) {
          const url = `${convertFileSrc(info.path)}?t=${Date.now()}`;
          setWallpaperBg(url);
          updateBrightness(url);
        }
      })
      .catch(() => {});

    const unlisten = listen("wallpaper-changed", () => {
      invoke<{ path: string } | null>("get_current_wallpaper")
        .then((info) => {
          if (info?.path) {
            const url = `${convertFileSrc(info.path)}?t=${Date.now()}`;
            const img = new Image();
            img.onload = () => {
              setFadingBg(url);
              updateBrightness(url);
              if (bgTimerRef.current) clearTimeout(bgTimerRef.current);
              bgTimerRef.current = setTimeout(() => {
                setWallpaperBg(url);
                setFadingBg(null);
              }, 1000);
            };
            img.onerror = () => setWallpaperBg(url);
            img.src = url;
          }
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
      className={`flex flex-col h-screen overflow-hidden select-none relative transition-colors duration-500 ${isLightBg ? "text-gray-900" : "text-white"}`}
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
      {fadingBg && (
        <div
          key={fadingBg}
          className="absolute inset-0 -z-10 animate-bg-fade"
          style={{
            backgroundImage: `url(${fadingBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(8px) brightness(0.5)",
            transform: "scale(1.05)",
          }}
        />
      )}
      {!wallpaperBg && !fadingBg && <div className="absolute inset-0 -z-10" style={{ background: "#07080e" }} />}

      {/* Sidebar blur gradient overlay — heavier blur that fades into main content */}
      {wallpaperBg && (
        <div
          className="absolute top-0 bottom-0 left-0 pointer-events-none"
          style={{
            width: "180px",
            backgroundImage: `url(${wallpaperBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(32px) brightness(0.4)",
            transform: "scale(1.1)",
            maskImage: "linear-gradient(to right, black 40%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to right, black 40%, transparent 100%)",
          }}
        />
      )}
      {fadingBg && (
        <div
          key={`sidebar-fade-${fadingBg}`}
          className="absolute top-0 bottom-0 left-0 pointer-events-none animate-bg-fade"
          style={{
            width: "180px",
            backgroundImage: `url(${fadingBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(32px) brightness(0.4)",
            transform: "scale(1.1)",
            maskImage: "linear-gradient(to right, black 40%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to right, black 40%, transparent 100%)",
          }}
        />
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar view={view} onNavigate={navigate} />

        <div key={view} className="flex-1 flex flex-col min-w-0">
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
