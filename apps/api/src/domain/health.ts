import type { HealthStatus } from "@repo/types";
import type { Clock, HealthService } from "./contracts";

/** Domain service. Depends only on its contracts — no Hono, no Node, no DB. */
export function createHealthService(clock: Clock): HealthService {
  return {
    check: (): HealthStatus => ({ status: "ok", ts: clock.now() }),
  };
}
