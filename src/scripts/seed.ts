import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  websites,
  consentCategory,
  policyVersion,
  type Website,
  ConsentCategory,
} from "../db/schema";

const TEST_DOMAIN = process.env.SEED_DOMAIN || "127.0.0.1";
const TEST_SITE_NAME = process.env.SEED_SITE_NAME || "Local Dev Server";

const CURRENT_POLICY_VERSION = "1.0.2";


// Policytexten bor i policies/base/<version>.html - EN kalla, versionshanterad i git.
// Behover en sajt en avvikande text (t.ex. Meta-pixel) laggs den i
// policies/<sajt>/<version>.html och publiceras med: npm run publish-policy
const POLICY_CONTENT_HTML = readFileSync(
  join("policies", "base", `${CURRENT_POLICY_VERSION}.html`),
  "utf-8",
);

const categoriesToSeed = [
  {
    key: "necessary",
    description: "Cookies necessary for basic website functionality.",
    is_required: true,
  },
  {
    key: "functional",
    description: "Remembers your choices and settings.",
    is_required: false,
  },
  {
    key: "analytics",
    description: "Used for visitor statistics and performance.",
    is_required: false,
  },
  {
    key: "marketing",
    description: "Used for targeted advertising.",
    is_required: false,
  },
];

const seed = async () => {
  let website: Website | undefined;
  try {
    console.log("Starting Database Seeding...");

    console.log(`[1/3] Seeding website: ${TEST_DOMAIN}`);

    const websiteRow = await db
      .select()
      .from(websites)
      .where(eq(websites.domain, TEST_DOMAIN))
      .limit(1);

    if (websiteRow.length === 0) {
      const result = await db
        .insert(websites)
        .values({
          name: TEST_SITE_NAME,
          domain: TEST_DOMAIN,
        })
        .returning();

      website = result[0];
      console.log(`Created new website ID: ${website!.id}`);
    } else {
      website = websiteRow[0];
      console.log(`Website already exists. Using Id: ${website!.id}`);
    }
    if (!website) {
      throw new Error("Could not find or create website row.");
    }
    const websiteId = website.id;

    console.log(`[2/3] Seeding policy version: ${CURRENT_POLICY_VERSION}`);

    const [policy] = await db
      .insert(policyVersion)
      .values({
        website_id: websiteId,
        version_label: CURRENT_POLICY_VERSION,
        content_html: POLICY_CONTENT_HTML,
        valid_from: new Date(),
      })

      .onConflictDoNothing({
        target: [policyVersion.website_id, policyVersion.version_label],
      })
      .returning({ id: policyVersion.id });

    const policyVersionId = policy?.id;

    if (policyVersionId) {
      console.log(`[Policy] NEW version seeded with ID: ${policyVersionId}`);
    } else {
      console.log(
        `[Policy] Version ${CURRENT_POLICY_VERSION} already exists. Skipping.`,
      );
    }

    console.log(" [3/3] Seeding consent categories...");
    for (const cat of categoriesToSeed) {
      await db
        .insert(consentCategory)
        .values({
          website_id: websiteId,
          key: cat.key,
          description: cat.description,
          is_required: cat.is_required,
        })
        .onConflictDoNothing({
          target: [consentCategory.website_id, consentCategory.key],
        });

      console.log(` Seeded category: ${cat.key}`);
    }

    console.log("Seeding completed succesfully");
  } catch (error) {
    console.error("seeding failed:", error);
    process.exit(1);
  }
  process.exit(0);
};
seed();
