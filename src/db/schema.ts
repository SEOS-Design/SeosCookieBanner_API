import {
  pgTable,
  unique,
  boolean,
  text,
  uuid,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// vilken hemsida använder bannern
export const websites = pgTable("websites", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Unikt client id per hemsida
export const identity = pgTable(
  "identity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    website_id: uuid("website_id")
      .notNull()
      .references(() => websites.id, { onDelete: "cascade" }),
    client_id: text("client_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    identityUnique: unique("identity_unique").on(
      table.website_id,
      table.client_id
    ),
  })
);
