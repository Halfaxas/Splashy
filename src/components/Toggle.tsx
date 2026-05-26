interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export default function Toggle({ enabled, onChange }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      style={{ width: "2.5rem", height: "1.375rem" }}
      className={`rounded-full relative transition-colors cursor-pointer shrink-0 ${
        enabled ? "bg-white" : "bg-white/20"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full shadow transition-all ${
          enabled ? "left-[calc(100%-1.125rem)] bg-slate-900" : "left-0.5 bg-white"
        }`}
      />
    </button>
  );
}
