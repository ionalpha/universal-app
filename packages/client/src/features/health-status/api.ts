import { type Health, HealthSchema } from "./model";

/** Fetch + validate the API health probe. Outbound edge of the health entity. */
export async function fetchHealth(apiUrl: string): Promise<Health> {
  const res = await fetch(`${apiUrl}/health`);
  if (!res.ok) throw new Error(`API responded ${res.status}`);
  return HealthSchema.parse(await res.json());
}
