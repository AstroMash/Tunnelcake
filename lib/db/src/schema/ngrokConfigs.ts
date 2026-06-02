import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { serversTable } from "./servers";

export const ngrokConfigsTable = sqliteTable("ngrok_configs", {
  serverId: integer("server_id")
    .primaryKey()
    .references(() => serversTable.id, { onDelete: "cascade" }),
  authToken: text("auth_token"),
  bearerToken: text("bearer_token").notNull(),
  domain: text("domain"),
  publicUrl: text("public_url"),
});

export const insertNgrokConfigSchema = createInsertSchema(ngrokConfigsTable);
export type InsertNgrokConfig = z.infer<typeof insertNgrokConfigSchema>;
export type NgrokConfig = typeof ngrokConfigsTable.$inferSelect;
