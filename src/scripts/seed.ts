import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { websites, consentCategory, type Website } from "../db/schema";

const TEST_DOMAIN = "127.0.0.1";
const TEST_SITE_NAME = "Local Dev Server";

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

    console.log(`[1/2] Seeding website: ${TEST_DOMAIN}`);

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
    console.log("Seeding consent categories...");
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
