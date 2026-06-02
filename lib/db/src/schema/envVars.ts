import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { serversTable } from "./servers";

export const envVarsTable = sqliteTable("env_vars", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serverId: integer("server_id").references(() => serversTable.id, {
    onDelete: "cascade",
  }),
  key: text("key").notNull(),
  value: text("value").notNull(),
});

export const insertEnvVarSchema = createInsertSchema(envVarsTable).omit({
  id: true,
});
export type InsertEnvVar = z.infer<typeof insertEnvVarSchema>;
export type EnvVar = typeof envVarsTable.$inferSelect;
