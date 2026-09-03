import { useQuery } from "@tanstack/react-query";

import { fetchHealth } from "../../shared/api/health";
import { serverUrl } from "../../shared/config/env";
import { HealthPanel } from "../../widgets/health/HealthPanel";

export function StatusPage() {
  const baseUrl = serverUrl();

  const { data, error, isPending } = useQuery({
    queryKey: ["health", baseUrl],
    queryFn: ({ signal }) => fetchHealth(baseUrl, signal),
    refetchInterval: 5000,
  });

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-950 p-6">
      <HealthPanel serverUrl={baseUrl} health={data} error={error} isPending={isPending} />
    </main>
  );
}
