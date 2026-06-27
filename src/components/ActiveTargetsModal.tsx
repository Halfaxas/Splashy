import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  CollectionSummary, UserSummary, TopicWithEnabled,
  QuerySummary, ColorSource, RelatedSourceSummary, TimeGroup,
} from "../types";
import {
  IconCollections, IconUsers, IconTopics,
  IconSearch, IconPalette, IconRelated,
} from "./icons";
import Toggle from "./Toggle";

// ── types ─────────────────────────────────────────────────────────────────────

type TargetKind = "collection" | "user" | "topic" | "query" | "color" | "related";

interface UnifiedTarget {
  kind: TargetKind;
  id: string;
  label: string;
  sublabel?: string;
  targetId: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getTargetId(kind: TargetKind, id: string): string {
  switch (kind) {
    case "collection": return `collection_${id}`;
    case "user":       return `user_${id}`;
    case "topic":      return `topic_${id}`;
    case "query":      return id;
    case "color":      return `color_${id}`;
    case "related":    return `related_${id}`;
  }
}

function formatHour(hour: number): string {
  if (hour === 0)  return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12)   return `${hour} AM`;
  return `${hour - 12} PM`;
}

// Parse "#rrggbb" into an [r, g, b] tuple. Falls back to a neutral grey.
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [136, 136, 136];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// Lighten a colour toward white so it stays legible on the dark glass surface.
function readableForeground([r, g, b]: [number, number, number]): string {
  const lift = (c: number) => Math.round(c + (255 - c) * 0.45);
  return `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`;
}

// ── SVG quadrant ring ─────────────────────────────────────────────────────────

// Build an annular arc path for a segment of a donut ring.
// Angles are clockwise from 12 o'clock (top), in degrees.
function arcPath(
  cx: number, cy: number,
  ro: number, ri: number,
  startDeg: number, endDeg: number,
): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const ox = (r: number, a: number) => cx + r * Math.sin(rad(a));
  const oy = (r: number, a: number) => cy - r * Math.cos(rad(a));

  const x1 = ox(ro, startDeg), y1 = oy(ro, startDeg); // outer start
  const x2 = ox(ro, endDeg),   y2 = oy(ro, endDeg);   // outer end
  const x3 = ox(ri, endDeg),   y3 = oy(ri, endDeg);   // inner end
  const x4 = ox(ri, startDeg), y4 = oy(ri, startDeg); // inner start

  // All segments are < 180° so large-arc-flag = 0
  return [
    `M ${x1} ${y1}`,
    `A ${ro} ${ro} 0 0 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${ri} ${ri} 0 0 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

// 4 fixed segments, 2° gap between each (1° inset on each side).
// Q1=top-right Morning, Q2=bottom-right Day, Q3=bottom-left Afternoon, Q4=top-left Night
const SEGMENT_DEFS = [
  { id: "morning",   start:   2, end:  88, color: "#fbbf24" }, // amber-400
  { id: "day",       start:  92, end: 178, color: "#fde047" }, // yellow-300
  { id: "afternoon", start: 182, end: 268, color: "#fb923c" }, // orange-400
  { id: "night",     start: 272, end: 358, color: "#818cf8" }, // indigo-400
];

interface QuadrantRingProps {
  timeGroups: TimeGroup[];
  targetId: string;
}

function QuadrantRing({ timeGroups, targetId }: QuadrantRingProps) {
  // 28×28 viewBox, center at (14,14), outer r=12.5, inner r=8
  return (
    <svg
      viewBox="0 0 28 28"
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    >
      {SEGMENT_DEFS.map(seg => {
        const group = timeGroups.find(g => g.id === seg.id);
        const isIn = group?.target_ids.includes(targetId) ?? false;
        if (!isIn) return null;
        return (
          <path
            key={seg.id}
            d={arcPath(14, 14, 12.5, 10.5, seg.start, seg.end)}
            fill={seg.color}
            opacity="0.75"
          />
        );
      })}
    </svg>
  );
}

// ── icons ─────────────────────────────────────────────────────────────────────

function IconClock({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5v3.75l2.5 1.5" />
    </svg>
  );
}

// ── group colours ─────────────────────────────────────────────────────────────

const GROUP_META: Record<string, { active: string; icon: string }> = {
  morning:   { active: "border-amber-400/50  bg-amber-400/12  text-amber-300",  icon: "☀️" },
  day:       { active: "border-yellow-300/50 bg-yellow-300/12 text-yellow-200", icon: "🌤" },
  afternoon: { active: "border-orange-400/50 bg-orange-400/12 text-orange-300", icon: "🌇" },
  night:     { active: "border-indigo-400/50 bg-indigo-400/12 text-indigo-300", icon: "🌙" },
};

// ── Time-groups sub-modal ─────────────────────────────────────────────────────

interface GroupsModalProps {
  target: UnifiedTarget;
  timeGroups: TimeGroup[];
  accent: string;
  onClose: () => void;
  onToggleGroup: (groupId: string, isIn: boolean) => Promise<void>;
}

function GroupsModal({ target, timeGroups, accent, onClose, onToggleGroup }: GroupsModalProps) {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accentFg = readableForeground(hexToRgb(accent));

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    timerRef.current = setTimeout(onClose, 160);
  }, [closing, onClose]);

  const groupLabel: Record<string, string> = {
    morning:   t("activeTargets.groupMorning"),
    day:       t("activeTargets.groupDay"),
    afternoon: t("activeTargets.groupAfternoon"),
    night:     t("activeTargets.groupNight"),
  };

  return (
    <div
      className={`fixed inset-0 bg-black/40 backdrop-blur-md z-60 flex items-center justify-center p-6 ${
        closing ? "modal-backdrop-out" : "modal-backdrop-in"
      }`}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className={`w-full max-w-xs transition-opacity duration-200 ${
        closing ? "opacity-0" : "opacity-100"
      }`}>
        <div className="relative rounded-3xl overflow-hidden border border-white/[0.12] shadow-2xl shadow-black/40">
          {/* Emulated liquid glass */}
          <div className="absolute inset-0 z-0 pointer-events-none backdrop-blur-2xl bg-white/[0.04]" />
          <div className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-br from-white/[0.08] via-transparent to-white/[0.03]" />
          <div className="absolute inset-0 z-0 pointer-events-none bg-black/35" />

          <div className="relative z-[2]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <IconClock className="w-4 h-4" style={{ color: accentFg }} />
            <div>
              <h3 className="text-sm font-semibold text-white">{t("activeTargets.groupsTitle")}</h3>
              <p className="text-[11px] text-white/40 mt-0.5 leading-none truncate max-w-45">{target.label}</p>
            </div>
          </div>
          <button
            onClick={close}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/8 shrink-0"
            style={{ color: accentFg }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </div>

        {/* Explanation */}
        <p className="px-5 pt-4 pb-2 text-xs text-white/40 leading-relaxed">
          {t("activeTargets.groupsExplain")}
        </p>

        {/* Groups */}
        <div className="px-3 pb-3 flex flex-col gap-1.5">
          {timeGroups.map(group => {
            const isIn = group.target_ids.includes(target.targetId);
            const gm = GROUP_META[group.id];
            const label = groupLabel[group.id] ?? group.label;
            const timeRange = `${formatHour(group.start_hour)} – ${formatHour(group.end_hour)}`;

            return (
              <button
                key={group.id}
                onClick={() => onToggleGroup(group.id, isIn)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all cursor-pointer text-left ${
                  isIn
                    ? (gm?.active ?? "border-white/20 bg-white/8 text-white")
                    : "border-white/6 bg-white/3 text-white/40 hover:border-white/12 hover:bg-white/5"
                }`}
              >
                <span className="text-base leading-none select-none">{gm?.icon ?? "⏱"}</span>
                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-medium block ${isIn ? "" : "text-white/40"}`}>{label}</span>
                  <span className="text-[11px] text-white/30 block">{timeRange}</span>
                </div>
                <Toggle
                  enabled={isIn}
                  onChange={() => {}}
                />
              </button>
            );
          })}
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── main modal ────────────────────────────────────────────────────────────────

const CLOSE_DURATION = 160;

interface Props {
  onClose: () => void;
}

export default function ActiveTargetsModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<UnifiedTarget[]>([]);
  const [timeGroups, setTimeGroups] = useState<TimeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [groupTarget, setGroupTarget] = useState<UnifiedTarget | null>(null);
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set());
  const [accent, setAccent] = useState<string>("#888888");
  const pendingChangesRef = useRef<Map<string, { kind: string; id: string; enabled: boolean }>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const KIND_META: Record<TargetKind, { label: string; Icon: React.FC<{ className?: string }> }> = {
    collection: { label: t("activeTargets.kindCollection"), Icon: IconCollections },
    user:       { label: t("activeTargets.kindUser"),       Icon: IconUsers },
    topic:      { label: t("activeTargets.kindTopic"),      Icon: IconTopics },
    query:      { label: t("activeTargets.kindQuery"),      Icon: IconSearch },
    color:      { label: t("activeTargets.kindColor"),      Icon: IconPalette },
    related:    { label: t("activeTargets.kindRelated"),    Icon: IconRelated },
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [collections, users, topics, queries, colors, related, groups] = await Promise.all([
        invoke<CollectionSummary[]>("list_collections"),
        invoke<UserSummary[]>("list_users"),
        invoke<TopicWithEnabled[]>("list_topics"),
        invoke<QuerySummary[]>("list_queries"),
        invoke<ColorSource[]>("list_colors"),
        invoke<RelatedSourceSummary[]>("list_related_sources"),
        invoke<TimeGroup[]>("get_time_groups"),
      ]);

      setTimeGroups(groups);

      const unified: UnifiedTarget[] = [
        ...collections.filter(c => c.enabled).map(c => ({
          kind: "collection" as const, id: c.id, targetId: getTargetId("collection", c.id),
          label: c.title, sublabel: c.author_name ?? undefined,
        })),
        ...users.filter(u => u.enabled).map(u => ({
          kind: "user" as const, id: u.username, targetId: getTargetId("user", u.username),
          label: u.name, sublabel: `@${u.username}`,
        })),
        ...topics.filter(t => t.enabled).map(t => ({
          kind: "topic" as const, id: t.id, targetId: getTargetId("topic", t.id),
          label: t.title,
        })),
        ...queries.filter(q => q.enabled).map(q => ({
          kind: "query" as const, id: q.id, targetId: getTargetId("query", q.id),
          label: q.value,
        })),
        ...colors.filter(c => c.enabled).map(c => ({
          kind: "color" as const, id: c.color, targetId: getTargetId("color", c.color),
          label: c.color.charAt(0).toUpperCase() + c.color.slice(1),
        })),
        ...related.filter(r => r.enabled).map(r => ({
          kind: "related" as const, id: r.photo_id, targetId: getTargetId("related", r.photo_id),
          label: `by ${r.author_name}`, sublabel: `@${r.author_username}`,
        })),
      ];

      setTargets(unified);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  useEffect(() => {
    invoke<string | null>("get_wallpaper_dominant_color")
      .then((hex) => { if (hex) setAccent(hex); })
      .catch(() => {});
  }, []);

  const accentRgb = hexToRgb(accent);
  const [ar, ag, ab] = accentRgb;
  const accentFg = readableForeground(accentRgb);
  const badgeStyle: React.CSSProperties = {
    backgroundColor: `rgba(${ar}, ${ag}, ${ab}, 0.16)`,
    borderColor: `rgba(${ar}, ${ag}, ${ab}, 0.28)`,
    color: accentFg,
  };

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    // Flush all pending toggle changes to backend in one batch
    const changes = Array.from(pendingChangesRef.current.values());
    if (changes.length > 0) {
      invoke("batch_toggle_sources", { changes }).catch((e) =>
        console.error("[ActiveTargetsModal] batch_toggle_sources failed:", e)
      );
      pendingChangesRef.current.clear();
    }
    timerRef.current = setTimeout(onClose, CLOSE_DURATION);
  }, [closing, onClose]);

  const handleToggle = (target: UnifiedTarget) => {
    const key = `${target.kind}:${target.id}`;
    const isCurrentlyDisabled = disabledIds.has(key);

    if (isCurrentlyDisabled) {
      // Re-enable locally
      setDisabledIds(prev => { const next = new Set(prev); next.delete(key); return next; });
      // If there was a pending disable, remove it; otherwise record an enable
      if (pendingChangesRef.current.has(key)) {
        pendingChangesRef.current.delete(key);
      } else {
        pendingChangesRef.current.set(key, { kind: target.kind, id: target.id, enabled: true });
      }
    } else {
      // Disable locally
      setDisabledIds(prev => new Set(prev).add(key));
      // If there was a pending enable, remove it; otherwise record a disable
      if (pendingChangesRef.current.has(key)) {
        pendingChangesRef.current.delete(key);
      } else {
        pendingChangesRef.current.set(key, { kind: target.kind, id: target.id, enabled: false });
      }
    }
  };

  const handleDisableAll = () => {
    const current = [...targets];
    for (const target of current) {
      const key = `${target.kind}:${target.id}`;
      if (!disabledIds.has(key)) {
        pendingChangesRef.current.set(key, { kind: target.kind, id: target.id, enabled: false });
      }
    }
    setDisabledIds(new Set(current.map(t => `${t.kind}:${t.id}`)));
  };

  const handleGroupToggle = async (groupId: string, isIn: boolean) => {
    if (!groupTarget) return;
    const tid = groupTarget.targetId;
    const newGroupIds = timeGroups
      .filter(g => (g.id === groupId ? !isIn : g.target_ids.includes(tid)))
      .map(g => g.id);

    setTimeGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        target_ids: isIn
          ? g.target_ids.filter(id => id !== tid)
          : [...g.target_ids, tid],
      };
    }));

    try {
      await invoke("set_target_groups", { targetId: tid, groupIds: newGroupIds });
    } catch {
      setTimeGroups(prev => prev.map(g => {
        if (g.id !== groupId) return g;
        return {
          ...g,
          target_ids: isIn
            ? [...g.target_ids, tid]
            : g.target_ids.filter(id => id !== tid),
        };
      }));
    }
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-md z-50 flex items-center justify-center p-6 ${
          closing ? "modal-backdrop-out" : "modal-backdrop-in"
        }`}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <div className={`w-full max-w-md transition-opacity duration-200 ${
          closing ? "opacity-0" : "opacity-100"
        }`}>
          <div className="relative max-h-[80vh] flex flex-col rounded-3xl overflow-hidden border border-white/[0.12] shadow-2xl shadow-black/40">
            {/* Emulated liquid glass — backdrop blur + layered gradients */}
            <div className="absolute inset-0 z-0 pointer-events-none backdrop-blur-2xl bg-white/[0.04]" />
            <div className="absolute inset-0 z-0 pointer-events-none bg-gradient-to-br from-white/[0.08] via-transparent to-white/[0.03]" />
            <div className="absolute inset-0 z-0 pointer-events-none bg-black/35" />

          {/* Content wrapper — above glass layers */}
          <div className="relative z-[2] flex flex-col flex-1 min-h-0">
          {/* Header */}
          <div className="shrink-0 px-6 pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white tracking-tight">{t("activeTargets.title")}</h2>
                {!loading && (
                  <p className="text-xs text-white/35 mt-1">
                    {targets.length - disabledIds.size === 0
                      ? t("activeTargets.noneActive")
                      : t("activeTargets.countActive", { count: targets.length - disabledIds.size })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {targets.length > 0 && (
                  <button
                    onClick={handleDisableAll}
                    className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/15 hover:border-red-500/30 transition-all cursor-pointer disabled:opacity-50 backdrop-blur-sm"
                  >
                    {t("activeTargets.disableAll")}
                  </button>
                )}
                <button
                  onClick={close}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/8"
                  style={{ color: accentFg }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="9" y2="9" />
                    <line x1="9" y1="1" x2="1" y2="9" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Separator */}
          <div className="shrink-0 mx-5 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-4 py-4">
            {loading ? (
              <div className="text-white/30 text-sm text-center py-12">{t("common.loading")}</div>
            ) : targets.length === 0 ? (
              <div className="text-white/30 text-sm text-center py-12">
                {t("activeTargets.emptyBody")}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {targets.map((target) => {
                  const meta = KIND_META[target.kind];
                  const Icon = meta.Icon;
                  const isDisabled = disabledIds.has(`${target.kind}:${target.id}`);

                  return (
                    <div
                      key={`${target.kind}:${target.id}`}
                      className={`group flex items-center gap-3 px-4 py-3 rounded-2xl border transition-[opacity,background-color,border-color] duration-200 ease-in-out ${
                        isDisabled
                          ? "bg-white/[0.01] border-white/[0.04] opacity-50"
                          : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.06] hover:border-white/[0.1]"
                      }`}
                    >
                      {/* Left column: badge on top, then name + subtext, all left-aligned */}
                      <div className="flex-1 min-w-0 flex flex-col items-start gap-1.5">
                        <div
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-semibold uppercase tracking-wide"
                          style={badgeStyle}
                        >
                          <Icon className="w-2.5 h-2.5" />
                          {meta.label}
                        </div>
                        <div className="min-w-0 w-full">
                          <span className="text-[13px] text-white/90 font-medium truncate block">{target.label}</span>
                          {target.sublabel && (
                            <span className="text-[11px] text-white/30 truncate block mt-0.5">{target.sublabel}</span>
                          )}
                        </div>
                      </div>

                      {/* Right side: clock with quadrant ring + enable toggle */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setGroupTarget(target)}
                          title={t("activeTargets.groupsTitle")}
                          className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/8 transition-all cursor-pointer shrink-0"
                        >
                          <QuadrantRing timeGroups={timeGroups} targetId={target.targetId} />
                          <IconClock className="relative z-10 w-3.5 h-3.5 text-white/35" />
                        </button>

                        <Toggle enabled={!isDisabled} onChange={() => handleToggle(target)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>
          </div>
        </div>
      </div>

      {/* Time-groups sub-modal */}
      {groupTarget && (
        <GroupsModal
          target={groupTarget}
          timeGroups={timeGroups}
          accent={accent}
          onClose={() => setGroupTarget(null)}
          onToggleGroup={handleGroupToggle}
        />
      )}
    </>
  );
}
