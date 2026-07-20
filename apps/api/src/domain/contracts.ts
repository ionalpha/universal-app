import type { HealthStatus } from "@repo/types";

/**
 * The interfaces the domain depends on. Infrastructure implements them; the
 * domain never imports a concrete implementation, only these contracts.
 */

/** A source of the current time (injected so the domain stays pure/testable). */
export interface Clock {
  now(): number;
}

/** The health use-case the HTTP layer calls. */
export interface HealthService {
  check(): HealthStatus;
}
