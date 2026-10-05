import type { ServerSummary } from "@voreli/shared";
import { useTranslation } from "react-i18next";

import { BrandMark } from "../../shared/ui/BrandMark";

interface ServerRailProps {
  readonly servers: readonly ServerSummary[];
  readonly activeServerId: string | null;
  readonly onHome: () => void;
  readonly onSelect: (serverId: string) => void;
}

export function ServerRail({ servers, activeServerId, onHome, onSelect }: ServerRailProps) {
  const { t } = useTranslation();

  return (
    <aside
      className="flex w-full shrink-0 flex-col items-center border-r border-line bg-rail py-3 md:w-[4.5rem]"
      aria-label={t("workspace.servers")}
    >
      <button
        type="button"
        onClick={onHome}
        aria-label={t("workspace.home")}
        title={t("workspace.home")}
        aria-current={activeServerId === null ? "page" : undefined}
        className="mb-3 flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 transition hover:bg-panel-hover md:h-12 md:w-12 md:justify-center md:px-0"
      >
        <span className="scale-90">
          <BrandMark compact />
        </span>
        <span className="text-sm font-semibold text-ink md:hidden">{t("workspace.home")}</span>
      </button>
      <div className="mb-3 h-px w-8 bg-line" />

      <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-2 py-1 md:w-auto">
        {servers.map((server) => {
          const active = server.id === activeServerId;

          return (
            <div key={server.id} className="group relative flex w-full items-center md:w-auto">
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
                  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-xs font-bold tracking-tight transition md:grid md:h-11 md:min-h-0 md:w-11 md:place-items-center md:rounded-[35%] md:px-0 " +
                  (active
                    ? "bg-accent text-white shadow-[0_8px_22px_rgba(124,108,246,.28)]"
                    : "bg-panel-raised text-ink-soft hover:rounded-2xl hover:bg-panel-hover hover:text-ink")
                }
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center md:h-auto md:w-auto">
                  {initials(server.name)}
                </span>
                <span className="truncate text-sm md:hidden">{server.name}</span>
              </button>
            </div>
          );
        })}
      </nav>

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
