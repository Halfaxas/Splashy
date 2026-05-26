import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";

type FilterState = "all" | "enabled" | "disabled";

interface SortOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  search: string;
  onSearch: (s: string) => void;
  filter: FilterState;
  onFilter: (f: FilterState) => void;
  sortBy: string;
  onSortBy: (s: string) => void;
  sortDir: "asc" | "desc";
  onSortDir: (d: "asc" | "desc") => void;
  sortOptions: SortOption[];
  searchPlaceholder?: string;
}

function SortDropdown({ value, options, onChange }: {
  value: string;
  options: SortOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 bg-white/6 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none hover:border-white/20 transition-colors cursor-pointer"
      >
        {selected?.label}
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" className="text-white/40">
          <path d="M0 0l4 5 4-5z" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-full rounded-lg border border-white/10 overflow-hidden shadow-2xl shadow-black/60"
          style={{ background: "#0f1117" }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer ${
                opt.value === value
                  ? "bg-white/12 text-white"
                  : "text-white/60 hover:bg-white/8 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FilterBar({
  search, onSearch,
  filter, onFilter,
  sortBy, onSortBy,
  sortDir, onSortDir,
  sortOptions,
  searchPlaceholder,
}: FilterBarProps) {
  const { t } = useTranslation();

  const FILTER_OPTIONS: { value: FilterState; label: string }[] = [
    { value: "all",      label: t("filterBar.all") },
    { value: "enabled",  label: t("filterBar.active") },
    { value: "disabled", label: t("filterBar.inactive") },
  ];

  return (
    <div className="flex flex-col gap-3 mb-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder ?? t("filterBar.all")}
          className="flex-1 bg-white/6 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 transition-colors"
        />
        <div className="flex rounded-lg overflow-hidden border border-white/10 shrink-0">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onFilter(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                filter === opt.value
                  ? "bg-white/15 text-white"
                  : "text-white/40 hover:text-white hover:bg-white/8"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/30">{t("filterBar.sortBy")}</span>
        <SortDropdown value={sortBy} options={sortOptions} onChange={onSortBy} />
        <button
          onClick={() => onSortDir(sortDir === "asc" ? "desc" : "asc")}
          title={sortDir === "asc" ? "Ascending" : "Descending"}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/10 bg-white/6 text-white/50 hover:text-white hover:border-white/20 transition-colors cursor-pointer text-sm"
        >
          {sortDir === "asc" ? "↑" : "↓"}
        </button>
      </div>
    </div>
  );
}
