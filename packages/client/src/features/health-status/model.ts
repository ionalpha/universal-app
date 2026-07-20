import type { HealthStatus } from "@repo/types";
import { z } from "zod";

// The client validates against the SAME contract the API returns (@repo/types),
// so the shared type and the runtime check can't drift.
export const HealthSchema = z.object({
  status: z.literal("ok"),
  ts: z.number(),
}) satisfies z.ZodType<HealthStatus>;

export type Health = HealthStatus;
