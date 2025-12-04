import {
  pgTable,
  unique,
  boolean,
  text,
  uuid,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { InferSelectModel, InferInsertModel } from "drizzle-orm";

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

export const consentCategory = pgTable(
  "consent_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    website_id: uuid("website_id")
      .notNull()
      .references(() => websites.id),
    key: text("key").notNull(),
    description: text("description"),
    is_required: boolean("is_required").notNull(),
  },
  (table) => ({
    siteKeyUnique: unique("site_key_unique").on(table.website_id, table.key),
  })
);

export const consentEvent = pgTable("consent_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  website_id: uuid("website_id")
    .notNull()
    .references(() => websites.id),
  identity_id: uuid("identity_id")
    .notNull()
    .references(() => identity.id),
  event_type: text("event_type").notNull(),
  user_agent: text("user_agent"),
  policy_version_text: text("policy_version_text"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const consentChoice = pgTable("consent_choice", {
  id: uuid("id").primaryKey().defaultRandom(),
  consent_event_id: uuid("consent_event_id")
    .notNull()
    .references(() => consentEvent.id, { onDelete: "cascade" }),
  consent_category_id: uuid("consent_category_id")
    .notNull()
    .references(() => consentCategory.id),
  status: boolean("status").notNull(),
});

// Relationer
export const websiteRelations = relations(websites, ({ many }) => ({
  // En hemsida har många identiteter, kategorier och event
  identities: many(identity),
  categories: many(consentCategory),
  events: many(consentEvent),
}));

export const identityRelations = relations(identity, ({ one, many }) => ({
  // En identitet/användare tillhör En hemsida
  website: one(websites, {
    fields: [identity.website_id],
    references: [websites.id],
  }),
  // En identitet har MÅNGA samtyckeshändelser
  consentEvents: many(consentEvent),
}));

export const consentEventRelations = relations(
  consentEvent,
  ({ one, many }) => ({
    // Ett event tillhör EN identitet
    identity: one(identity, {
      fields: [consentEvent.identity_id],
      references: [identity.id],
    }),
    // Ett event har MÅNGA val (choice)
    choices: many(consentChoice),
  })
);

export const consentChoiceRelations = relations(consentChoice, ({ one }) => ({
  //Ett val tillhör ETT event
  event: one(consentEvent, {
    fields: [consentChoice.consent_event_id],
    references: [consentEvent.id],
  }),
  // Ett val tillhör EN kategori
  category: one(consentCategory, {
    fields: [consentChoice.consent_category_id],
    references: [consentCategory.id],
  }),
}));

export const consentCategoryRelations = relations(
  consentCategory,
  ({ many }) => ({
    // En kategori har MÅNGA val
    choices: many(consentChoice),
  })
);

//InferSelectModel = när man läser från DB
//InferInsertModel = när man skriver till DB
// Website types
export type Website = InferSelectModel<typeof websites>;
export type NewWebsite = InferInsertModel<typeof websites>;
// Identity types
export type Identity = InferSelectModel<typeof identity>;
export type NewIdentity = InferInsertModel<typeof identity>;
// Consent_category types
export type ConsentCategory = InferSelectModel<typeof consentCategory>;
export type NewConsentCategory = InferInsertModel<typeof consentCategory>;
// Consent_event types
export type ConsentEvent = InferSelectModel<typeof consentEvent>;
export type NewConsentEvent = InferInsertModel<typeof consentEvent>;
//Consent_choice types
export type ConsentChoice = InferSelectModel<typeof consentChoice>;
export type NewConsentChoice = InferInsertModel<typeof consentChoice>;
