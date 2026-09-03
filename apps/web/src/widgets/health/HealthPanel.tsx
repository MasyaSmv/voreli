import type { HealthResponse } from "@voreli/shared";

interface HealthPanelProps {
  readonly serverUrl: string;
  readonly health: HealthResponse | undefined;
  readonly error: Error | null;
  readonly isPending: boolean;
}

function formatUptime(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;

  return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

function statusLabel(isPending: boolean, error: Error | null): string {
  if (isPending) {
    return "проверяем…";
  }

  return error === null ? "на связи" : "недоступен";
}

export function HealthPanel({ serverUrl, health, error, isPending }: HealthPanelProps) {
  return (
    <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
      <h1 className="text-lg font-semibold text-white">Voreli</h1>
      <p className="mt-1 text-sm text-white/50">{serverUrl}</p>

      <dl className="mt-6 space-y-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-white/50">Сервер</dt>
          <dd data-testid="health-status" className="font-medium text-white">
            {statusLabel(isPending, error)}
          </dd>
        </div>

        {health ? (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-white/50">Аптайм</dt>
              <dd data-testid="health-uptime" className="font-mono text-white">
                {formatUptime(health.uptime)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-white/50">Версия</dt>
              <dd data-testid="health-version" className="font-mono text-white">
                {health.version}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {error ? (
        <p data-testid="health-error" className="mt-4 text-sm text-red-300">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
