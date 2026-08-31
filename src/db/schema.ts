import {
  pgTable,
  unique,
  index,
  boolean,
  jsonb,
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
  // Publik nyckel som identifierar sajten i stallet for hostname.
  // Nullable under overgangen - blir obligatorisk nar alla sajter har en.
  site_key: text("site_key").unique(),
  // Tillatna origins for denna sajt (produktion + staging).
  // Tom lista = ingen origin-kontroll (utvecklingslage).
  allowed_origins: text("allowed_origins").array().notNull().default([]),
  // Sajtens designvarden (C1 steg 1). Nyckel/varde dar nyckeln ar ett
  // CSS-variabelnamn utan inledande streck: {"bg-main": "#f5f0e6"}.
  //
  // jsonb och inte en kolumn per variabel: listan kommer att vaxa, och varje
  // ny variabel hade annars varit en schemaandring i produktion. Priset ar att
  // databasen inte validerar innehallet - det gor API:t i stallet, mot en
  // tillaten lista (se routes/config.ts).
  //
  // Tomt objekt = sajten kor bannerns standardvarden. Sa lange kolumnen ar tom
  // pa alla sajter beter sig allt exakt som fore C1.
  design: jsonb("design").$type<Record<string, string>>().notNull().default({}),
  // Sajtens egna texter (C1 steg 3). Nycklat på språk, sedan kategori, sedan
  // fält: {"sv": {"marketing": {"notice": "Vi använder inga …"}}}.
  //
  // jsonb och samma resonemang som design: listan över fält kommer att växa,
  // och varje nytt fält hade annars varit en schemaändring i produktion.
  // Databasen validerar inte innehållet — det gör API:t mot en tillåten lista
  // (se routes/config.ts).
  //
  // ALLT ÄR VALFRITT. Ett fält som saknas hämtas ur bannerns egen språktabell,
  // så ett tomt objekt betyder att sajten kör bannerns texter — exakt som före
  // steg 3. Det är därför utrullningen inte behöver röra en enda rad.
  //
  // ⚠️ REN TEXT, ALDRIG HTML. Bannern skriver värdena med textContent. Det är
  // hela skälet till att steg 3 inte öppnar något XSS-hål.
  texts: jsonb("texts").$type<Record<string, unknown>>().notNull().default({}),
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
      .references(() => websites.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    description: text("description"),
    is_required: boolean("is_required").notNull(),
    // Om kategorin ska visas i bannerns installningsruta (C1 steg 2).
    //
    // true som standard: sa lange ingen rad satts till false beter sig allt
    // exakt som fore steg 2, aven med bade API och banner ute.
    //
    // FALSE - ALDRIG DELETE. consent_choice pekar hit med ON DELETE CASCADE,
    // sa att radera raden raderar varje historiskt val for kategorin. Det ar
    // bevis, och det gar inte att aterskapa. Se
    // migrationer/2026-08-28-kategorier-aktiva.sql.
    is_active: boolean("is_active").notNull().default(true),
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
      .references(() => websites.id, { onDelete: "cascade" }),
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
export const consentEvent = pgTable(
  "consent_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    website_id: uuid("website_id")
      .notNull()
      .references(() => websites.id, { onDelete: "cascade" }),
    identity_id: uuid("identity_id")
      .notNull()
      .references(() => identity.id, { onDelete: "cascade" }),
    policy_version_id: uuid("policy_version_id")
      .notNull()
      .references(() => policyVersion.id, { onDelete: "cascade" }),
    event_type: text("event_type").notNull(),
    user_agent: text("user_agent"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Rapportering per sajt och tidsperiod
    websiteCreatedIdx: index("consent_event_website_created_idx").on(
      table.website_id,
      table.created_at,
    ),
    // Uppslag av en besokares historik (bevisforing vid tvist)
    identityIdx: index("consent_event_identity_idx").on(table.identity_id),
    // Kravs for att cascade-radering av policyversion ska ga snabbt
    policyVersionIdx: index("consent_event_policy_version_idx").on(
      table.policy_version_id,
    ),
  }),
);

export const consentChoice = pgTable(
  "consent_choice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consent_event_id: uuid("consent_event_id")
      .notNull()
      .references(() => consentEvent.id, { onDelete: "cascade" }),
    consent_category_id: uuid("consent_category_id")
      .notNull()
      .references(() => consentCategory.id, { onDelete: "cascade" }),
    status: boolean("status").notNull(),
  },
  (table) => ({
    // Hamta valen for ett event + snabb cascade-radering
    eventIdx: index("consent_choice_event_idx").on(table.consent_event_id),
    // Cascade-radering fran kategori
    categoryIdx: index("consent_choice_category_idx").on(
      table.consent_category_id,
    ),
  }),
);

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
