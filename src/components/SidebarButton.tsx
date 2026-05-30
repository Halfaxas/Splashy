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
      className={`relative w-full flex flex-col items-center gap-1 py-3 px-2 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer ${
        active
          ? "bg-white/8 text-white"
          : "text-white/50 hover:text-white hover:bg-white/5"
      }`}
    >
      {active && (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-white/60" />
      )}
      {icon}
      <span>{label}</span>
    </button>
  );
}
