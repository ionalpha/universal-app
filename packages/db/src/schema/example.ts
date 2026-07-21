import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * ⚠️ EXAMPLE schema - reference only. Delete this file and replace with your
 * own tables. Convention: one table per file under schema/, re-exported from
 * schema/index.ts, so the schema never becomes one giant file.
 */
export const exampleItems = sqliteTable("example_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export type ExampleItem = typeof exampleItems.$inferSelect;
export type NewExampleItem = typeof exampleItems.$inferInsert;
