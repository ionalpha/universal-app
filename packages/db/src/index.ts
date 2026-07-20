import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export * from "./schema";

export interface DbConfig {
  /** libSQL URL. `file:...` for local, `libsql://...` for Turso cloud. */
  url: string;
  /** Auth token for Turso cloud (omit for local file). */
  authToken?: string;
}

/**
 * Create a Drizzle client backed by libSQL.
 * The same schema flows to types on the API and the RPC client.
 */
export function createDb({ url, authToken }: DbConfig) {
  const client = createClient({ url, authToken });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
