import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();
const isMac = navigator.userAgent.includes("Mac");

function onDragStart(e: React.MouseEvent) {
  if (e.button === 0) win.startDragging();
}

export default function TitleBar() {
  return (
    <div
      className="h-8 flex items-center shrink-0 select-none"
      style={{ background: "#000000" }}
    >
      {/* Draggable area */}
      <div onMouseDown={onDragStart} className="flex-1 h-full" />

      {/* Window controls — hidden on macOS (native traffic lights are used) */}
      <div className={`flex items-stretch h-full ${isMac ? "hidden" : ""}`}>
        <button
          onClick={() => win.minimize()}
          className="w-11 flex items-center justify-center text-white/35 hover:text-white hover:bg-white/8 transition-colors cursor-default"
          title="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>

        <button
          onClick={() => win.toggleMaximize()}
          className="w-11 flex items-center justify-center text-white/35 hover:text-white hover:bg-white/8 transition-colors cursor-default"
          title="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        </button>

        <button
          onClick={() => win.close()}
          className="w-11 flex items-center justify-center text-white/35 hover:text-white hover:bg-red-500/80 transition-colors cursor-default"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
