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

// WHICH WEBSITE IS USING THE BANNER
export const websites = pgTable("websites", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// UNIQUE CLIENT ID PER WEBSITE
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
      table.client_id,
    ),
  }),
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
  }),
);

export const policyVersion = pgTable(
  "policy_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    website_id: uuid("website_id")
      .notNull()
      .references(() => websites.id),
    version_label: text("version_label").notNull(),
    content_html: text("content_html").notNull(),
    valid_from: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    policyVersionUnique: unique("policy_version_unique").on(
      table.website_id,
      table.version_label,
    ),
  }),
);
export const consentEvent = pgTable("consent_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  website_id: uuid("website_id")
    .notNull()
    .references(() => websites.id),
  identity_id: uuid("identity_id")
    .notNull()
    .references(() => identity.id),
  policy_version_id: uuid("policy_version_id")
    .notNull()
    .references(() => policyVersion.id),
  event_type: text("event_type").notNull(),
  user_agent: text("user_agent"),
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

// RELATIONS
export const websiteRelations = relations(websites, ({ many }) => ({
  // ONE WEBSITE HAS MANY IDENTITITES, CATEGORIES AND EVENTS
  identities: many(identity),
  categories: many(consentCategory),
  events: many(consentEvent),
  policies: many(policyVersion),
}));

export const identityRelations = relations(identity, ({ one, many }) => ({
  // ONE IDENTITY/USER BELONGS TO ONE WEBSITE
  website: one(websites, {
    fields: [identity.website_id],
    references: [websites.id],
  }),
  //  ONE IDENTITY HAS MANY CONSENTECENTS
  consentEvents: many(consentEvent),
}));

export const consentEventRelations = relations(
  consentEvent,
  ({ one, many }) => ({
    website: one(websites, {
      fields: [consentEvent.website_id],
      references: [websites.id],
    }),
    // ONE EVENT BELONGS TO ONE IDENTITY
    identity: one(identity, {
      fields: [consentEvent.identity_id],
      references: [identity.id],
    }),
    // ONE EVENT HAS MANY CHOICES
    choices: many(consentChoice),

    policyVersion: one(policyVersion, {
      fields: [consentEvent.policy_version_id],
      references: [policyVersion.id],
    }),
  }),
);

export const consentChoiceRelations = relations(consentChoice, ({ one }) => ({
  //ONE CHOICE BELONGS TO ONE EVENT
  event: one(consentEvent, {
    fields: [consentChoice.consent_event_id],
    references: [consentEvent.id],
  }),
  // ONE CHOICE BELONGS TO ONE CATEGORY
  category: one(consentCategory, {
    fields: [consentChoice.consent_category_id],
    references: [consentCategory.id],
  }),
}));

export const consentCategoryRelations = relations(
  consentCategory,
  ({ one, many }) => ({
    website: one(websites, {
      fields: [consentCategory.website_id],
      references: [websites.id],
    }),
    // ONE CATEGORY HAS MANY CHOICES
    choices: many(consentChoice),
  }),
);

export const policyVersionRelations = relations(policyVersion, ({ one }) => ({
  website: one(websites, {
    fields: [policyVersion.website_id],
    references: [websites.id],
  }),
}));

//InferSelectModel = when reading from DB
//InferInsertModel = when writing to DB
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
