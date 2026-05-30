import GlassPanel from "./GlassPanel";

interface SidebarButtonProps {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

export default function SidebarButton({ label, icon, active, onClick }: SidebarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative w-full flex flex-col items-center gap-1 py-3 px-2 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer overflow-hidden ${
        active
          ? "text-white"
          : "text-white/50 hover:text-white hover:bg-white/5"
      }`}
    >
      {active && (
        <div className="absolute inset-0 -z-10">
          <GlassPanel cornerRadius={12} className="w-full h-full" />
        </div>
      )}
      {icon}
      <span>{label}</span>
    </button>
  );
}
