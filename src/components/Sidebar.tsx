import { useTranslation } from "react-i18next";
import { View } from "../types";
import { IconCollections, IconHome, IconPalette, IconRelated, IconSearch, IconSettings, IconTopics, IconUsers } from "./icons";
import SidebarButton from "./SidebarButton";

interface SidebarProps {
  view: View;
  onNavigate: (v: View) => void;
}

export default function Sidebar({ view, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  return (
    <aside className="w-20 flex flex-col items-center pt-3 pb-4 shrink-0 relative">

      <div className="relative z-10 flex flex-col items-center gap-1 flex-1 w-full overflow-y-auto min-h-0">
        <SidebarButton
          label={t("nav.home")}
          icon={<IconHome className="w-5 h-5" />}
          active={view === "home"}
          onClick={() => onNavigate("home")}
        />
        <SidebarButton
          label={t("nav.collections")}
          icon={<IconCollections className="w-5 h-5" />}
          active={view === "collections"}
          onClick={() => onNavigate("collections")}
        />
        <SidebarButton
          label={t("nav.users")}
          icon={<IconUsers className="w-5 h-5" />}
          active={view === "users"}
          onClick={() => onNavigate("users")}
        />
        <SidebarButton
          label={t("nav.topics")}
          icon={<IconTopics className="w-5 h-5" />}
          active={view === "topics"}
          onClick={() => onNavigate("topics")}
        />
        <SidebarButton
          label={t("nav.queries")}
          icon={<IconSearch className="w-5 h-5" />}
          active={view === "queries"}
          onClick={() => onNavigate("queries")}
        />
        <SidebarButton
          label={t("nav.colors")}
          icon={<IconPalette className="w-5 h-5" />}
          active={view === "colors"}
          onClick={() => onNavigate("colors")}
        />
        <SidebarButton
          label={t("nav.related")}
          icon={<IconRelated className="w-5 h-5" />}
          active={view === "related"}
          onClick={() => onNavigate("related")}
        />
      </div>

      <div className="relative z-10 w-full flex flex-col items-center">
        <SidebarButton
          label={t("nav.settings")}
          icon={<IconSettings className="w-5 h-5" />}
          active={view === "settings"}
          onClick={() => onNavigate("settings")}
        />
      </div>
    </aside>
  );
}
