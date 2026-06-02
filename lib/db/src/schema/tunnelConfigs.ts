import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { serversTable } from "./servers";

export const tunnelConfigsTable = pgTable("tunnel_configs", {
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
