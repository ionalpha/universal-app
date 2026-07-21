/**
 * ⚠️ EXAMPLE - reference only. Nothing runs this; no table is created for you.
 * It shows the repository pattern with Drizzle + libSQL: inject a Database and
 * run typed queries. Copy the SHAPE into your own feature - do NOT build on top
 * of this file. Delete it (and schema/example.ts) once you have real tables.
 * Generate migrations with `pnpm --filter @repo/db generate` when ready.
 */
import type { Database } from "./index";
import { type ExampleItem, exampleItems } from "./schema";

export function createExampleRepository(db: Database) {
  return {
    list: async (): Promise<ExampleItem[]> =>
      db.select().from(exampleItems).orderBy(exampleItems.id),

    create: async (title: string): Promise<ExampleItem> => {
      const [row] = await db.insert(exampleItems).values({ title }).returning();
      if (!row) throw new Error("Insert returned no row");
      return row;
    },
  };
}
