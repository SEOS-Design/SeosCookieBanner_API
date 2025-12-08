import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  websites,
  consentCategory,
  policyVersion,
  type Website,
  ConsentCategory,
} from "../db/schema";

const TEST_DOMAIN = "127.0.0.1";
const TEST_SITE_NAME = "Local Dev Server";

const POLICY_CONTENT_HTML = `
<h2>Cookie Policy - Version 1.0.1</h2>
<p>Denna policy trädde i kraft ${new Date().toLocaleDateString(
  "sv-SE"
)} och ersätter alla tidigare versioner.</p>
<h3>1. Nödvändiga Cookies</h3>
<p>Dessa är nödvändiga för att webbplatsen ska fungera och kan inte stängas av.</p>
<h3>Cookies för Statistik</h3>
<p>Vi använder analytiska cookies för att mäta trafik och förbättra din upplevelse</p>
`;

const categoriesToSeed = [
  {
    key: "necessary",
    description: "Cookies nödvändiga för grundläggande funktionalitet.",
    is_required: true,
  },
  {
    key: "functional",
    description: "Minns dina val och inställningar.",
    is_required: false,
  },
  {
    key: "analytics",
    description: "Används för besöksstatistik.",
    is_required: false,
  },
  {
    key: "marketing",
    description: "Används för riktad reklam",
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

    console.log("[2/3] Seeding initial policy Version");

    const [policy] = await db
      .insert(policyVersion)
      .values({
        website_id: websiteId,
        version_label: "1.0.1",
        content_html: POLICY_CONTENT_HTML,
        valid_from: new Date(),
      })

      .onConflictDoNothing({
        target: [policyVersion.website_id, policyVersion.version_label],
      })
      .returning({ id: policyVersion.id });

    const policyVersionId = policy?.id;

    console.log(
      `[Policy] Seeded version 1.0.1 with ID: ${
        policyVersionId || "Already Existed"
      }`
    );

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
