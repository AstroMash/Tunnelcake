import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { serversTable } from "./servers";

export const tunnelConfigsTable = sqliteTable("tunnel_configs", {
  serverId: integer("server_id")
    .primaryKey()
    .references(() => serversTable.id, { onDelete: "cascade" }),
  tunnelId: text("tunnel_id").notNull(),
  apiKey: text("api_key"),
  uiUrl: text("ui_url"),
});

export const insertTunnelConfigSchema = createInsertSchema(tunnelConfigsTable);
export type InsertTunnelConfig = z.infer<typeof insertTunnelConfigSchema>;
export type TunnelConfig = typeof tunnelConfigsTable.$inferSelect;
