import { pgTable, text, serial, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const serversTable = pgTable("servers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  command: text("command").notNull(),
  args: jsonb("args").$type<string[]>().notNull().default([]),
  connectionMode: text("connection_mode").notNull().default("none"),
  running: boolean("running").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertServerSchema = createInsertSchema(serversTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertServer = z.infer<typeof insertServerSchema>;
export type Server = typeof serversTable.$inferSelect;
