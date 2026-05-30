import { useState, useEffect, useCallback } from "react";
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
import TitleBar from "./components/TitleBar";

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
  const [isLightBg, setIsLightBg] = useState(false);

  // Two-layer flip-flop for seamless crossfade
  const [layerA, setLayerA] = useState<string | null>(null);
  const [layerB, setLayerB] = useState<string | null>(null);
  const [showB, setShowB] = useState(false); // which layer is on top
  const activeUrl = showB ? layerB : layerA;

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
          setLayerA(url);
          setShowB(false);
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
              // Put new image on the hidden layer, then reveal it
              setShowB((prev) => {
                if (prev) {
                  setLayerA(url);
                } else {
                  setLayerB(url);
                }
                return !prev;
              });
              updateBrightness(url);
            };
            img.onerror = () => {
              setShowB((prev) => {
                if (prev) { setLayerA(url); } else { setLayerB(url); }
                return !prev;
              });
            };
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
      {/* Blurred wallpaper background — two layers crossfading via opacity transition */}
      {layerA && (
        <div
          className="absolute inset-0 -z-10 transition-opacity duration-1000 ease-in-out"
          style={{
            opacity: showB ? 0 : 1,
            backgroundImage: `url(${layerA})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(8px) brightness(0.5)",
            transform: "scale(1.05)",
          }}
        />
      )}
      {layerB && (
        <div
          className="absolute inset-0 -z-10 transition-opacity duration-1000 ease-in-out"
          style={{
            opacity: showB ? 1 : 0,
            backgroundImage: `url(${layerB})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(8px) brightness(0.5)",
            transform: "scale(1.05)",
          }}
        />
      )}
      {!activeUrl && <div className="absolute inset-0 -z-10" style={{ background: "#07080e" }} />}

      {!navigator.userAgent.includes("Mac") && <TitleBar />}

      {/* Sidebar blur gradient overlay — same two-layer crossfade */}
      {layerA && (
        <div
          className="absolute top-0 bottom-0 left-0 pointer-events-none transition-opacity duration-1000 ease-in-out"
          style={{
            opacity: showB ? 0 : 1,
            width: "180px",
            backgroundImage: `url(${layerA})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(32px) brightness(0.4)",
            transform: "scale(1.1)",
            maskImage: "linear-gradient(to right, black 40%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to right, black 40%, transparent 100%)",
          }}
        />
      )}
      {layerB && (
        <div
          className="absolute top-0 bottom-0 left-0 pointer-events-none transition-opacity duration-1000 ease-in-out"
          style={{
            opacity: showB ? 1 : 0,
            width: "180px",
            backgroundImage: `url(${layerB})`,
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
