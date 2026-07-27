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

const TEST_DOMAIN = process.env.SEED_DOMAIN || "127.0.0.1";
const TEST_SITE_NAME = process.env.SEED_SITE_NAME || "Local Dev Server";

const CURRENT_POLICY_VERSION = "1.0.2";

const today = new Date().toISOString().split("T")[0];

const POLICY_CONTENT_HTML = `
<div class="policy-container">
    <h3>1. Introduktion</h3>
    <p>
      Denna cookiepolicy förklarar hur cookies används på denna webbplats, vad de används till och hur du kan hantera
  dina inställningar.
    </p>
    <p>
      Cookies kan placeras antingen av webbplatsoperatören eller av tredjepartstjänster som är integrerade i
  webbplatsen.
    </p>

    <h3>2. Vad är cookies?</h3>
    <p>
      Cookies är små textfiler som placeras på din enhet (dator, surfplatta eller mobil) när du besöker en webbplats.
  Cookies används allmänt för att webbplatser ska fungera effektivare, förbättra användarupplevelsen och ge information
  till webbplatsoperatören.
    </p>

    <h3>3. Rättslig grund för användning av cookies</h3>
    <p>
      Användningen av strikt nödvändiga cookies grundar sig på webbplatsoperatörens berättigade intresse av att
  säkerställa webbplatsens korrekta funktion.
    </p>
    <p>
      Alla andra cookies används enbart efter att du lämnat ditt uttryckliga samtycke.
    </p>

    <h3>4. Samtyckeshantering</h3>
    <p>
      När du besöker webbplatsen för första gången ombeds du att göra ett val angående användningen av cookies. Dina
  inställningar sparas för att säkerställa att dina val respekteras vid framtida besök.
    </p>
    <p>
      Du kan när som helst ändra eller återkalla ditt samtycke genom att öppna cookieinställningarna via den länk eller
  knapp som finns tillgänglig på webbplatsen.
    </p>

    <h3>5. Strikt nödvändiga cookies</h3>
    <p>Dessa cookies är nödvändiga för att webbplatsen ska fungera korrekt och kan inte inaktiveras. De kräver inte ditt
   samtycke.</p>

    <div class="table-wrapper">
      <table class="policy-table">
        <thead>
          <tr>
            <th>Namn</th>
            <th>Syfte</th>
            <th>Varaktighet</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>consent_status</strong></td>
            <td>Lagrar ditt allmänna val gällande cookie-samtycke.</td>
            <td>30 dagar</td>
          </tr>
          <tr>
            <td><strong>consent_choices</strong></td>
            <td>Lagrar detaljerade inställningar för cookiekategorier.</td>
            <td>30 dagar</td>
          </tr>
          <tr>
            <td><strong>client_consent_id</strong></td>
            <td>Ett unikt, anonymt ID som används för att verifiera att ett giltigt samtycke har lämnats.</td>
            <td>365 dagar</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h3>6. Valfria cookies och tredjepartstjänster</h3>
    <p>
      Med ditt samtycke kan denna webbplats använda tredjepartstjänster såsom analysverktyg eller
  marknadsföringsverktyg. Dessa cookies används för att förstå hur besökare interagerar med webbplatsen och för att
  förbättra dess funktionalitet och innehåll.
    </p>

    <div class="table-wrapper">
      <table class="policy-table">
        <thead>
          <tr>
            <th>Tjänst</th>
            <th>Kategori</th>
            <th>Syfte</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Google Analytics</td>
            <td>Analys</td>
            <td>Samlar in information om webbplatsanvändning för att förbättra prestanda och användarupplevelse.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h3>7. Google Consent Mode</h3>
    <p>
      Denna webbplats använder Google Consent Mode för att säkerställa att Googles tjänster respekterar dina
  samtyckesval. Beroende på ditt val kan Google-taggar anpassa sitt beteende.
    </p>

    <h3>8. Personuppgiftsansvarig</h3>
    <p>
      Webbplatsoperatören är personuppgiftsansvarig för behandlingen av personuppgifter på denna webbplats.
    </p>
    <p>
      För information om hur du kontaktar webbplatsoperatören, se kontaktuppgifterna på webbplatsen.
    </p>

    <h3>9. Uppdateringar av denna policy</h3>
    <p>
      Denna cookiepolicy kan komma att uppdateras för att återspegla ändringar i lagkrav eller vår användning av
  cookies.
    </p>

    <div class="policy-footer-note">
      <p>Denna policy gäller från ${today}.</p>
      <p>Aktuell version: ${CURRENT_POLICY_VERSION}</p>
    </div>
  </div>
`;

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
