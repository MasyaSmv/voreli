import type { ServerSummary } from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { BrandMark } from "../../shared/ui/BrandMark";
import { LanguageSwitcher } from "../../shared/ui/LanguageSwitcher";

interface ServerRailProps {
  readonly servers: readonly ServerSummary[];
  readonly activeServerId: string | null;
  readonly onSelect: (serverId: string) => void;
}

export function ServerRail({ servers, activeServerId, onSelect }: ServerRailProps) {
  const { t } = useTranslation();

  return (
    <aside
      className="flex w-[4.5rem] shrink-0 flex-col items-center border-r border-line bg-rail py-3"
      aria-label={t("workspace.servers")}
    >
      <div className="mb-3 scale-90">
        <BrandMark compact />
      </div>
      <div className="mb-3 h-px w-8 bg-line" />

      <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-2 py-1">
        {servers.map((server) => {
          const active = server.id === activeServerId;

          return (
            <div key={server.id} className="group relative flex items-center">
              <span
                className={
                  "absolute -left-3 w-1 rounded-r-full bg-ink transition-all " +
                  (active ? "h-8" : "h-0 group-hover:h-4")
                }
                aria-hidden="true"
              />
              <button
                type="button"
                title={server.name}
                aria-label={server.name}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  onSelect(server.id);
                }}
                className={
                  "grid h-11 w-11 place-items-center rounded-[35%] text-xs font-bold tracking-tight transition " +
                  (active
                    ? "bg-accent text-white shadow-[0_8px_22px_rgba(124,108,246,.28)]"
                    : "bg-panel-raised text-ink-soft hover:rounded-2xl hover:bg-panel-hover hover:text-ink")
                }
              >
                {initials(server.name)}
              </button>
            </div>
          );
        })}
      </nav>

      <LanguageSwitcher compact />
      <span
        className="mt-3 h-2 w-2 rounded-full bg-voice shadow-[0_0_12px_rgba(90,215,177,.65)]"
        title={t("workspace.statusOnline")}
      />
    </aside>
  );
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toLocaleUpperCase("ru-RU");
}
