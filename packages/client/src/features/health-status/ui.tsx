import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../components/badge";
import { ErrorState, LoadingState } from "../../components/states";
import { fetchHealth } from "./api";

/** Live API reachability. The feature owns its data access (api.ts + model.ts). */
export function HealthStatus({ apiUrl }: { apiUrl: string }) {
  const health = useQuery({
    queryKey: ["health", apiUrl],
    queryFn: () => fetchHealth(apiUrl),
    retry: false,
  });

  if (health.isPending) return <LoadingState label="Checking API…" />;
  if (health.isError) return <ErrorState title="API unreachable" description={apiUrl} />;
  return <Badge>ok · {new Date(health.data.ts).toLocaleTimeString()}</Badge>;
}
