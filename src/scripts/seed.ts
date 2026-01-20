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

const CURRENT_POLICY_VERSION = "1.0.1";

const today = new Date().toISOString().split("T")[0];

const POLICY_CONTENT_HTML = `
<div class="policy-container">
  <h3>1. Introduction</h3>
  <p>
    This cookie policy explains how cookies are used on this website, what they are used for and how you can manage your preferences.
  </p>
  <p>
    Cookies may be placed either by the website operator or by third-party services integrated into the website.
  </p>

  <h3>2. What are cookies?</h3>
  <p>
    Cookies are small text files that are placed on your device (computer, tablet or mobile) when you visit a website. Cookies are widely used to make websites work more efficiently, improve user experience and provide information to the website operator. 
  </p>

  <h3>3. Legal basis for the use of cookies</h3>
  <p>
    The use of strictly necessary cookies is based on the website operator's legitimate interest in ensuring the proper functioning of the website.
  </p>
  <p>
    All other cookies are only used after you have given your explicit consent.
  </p>
  
  <h3>4. Consent management</h3>
  <p>
    When you first visit this website, you are asked to make a choice regarding the use of cookies. Your preferences are stored to ensure that your choices are respected on future visits.
  </p>
  <p>
    You can change or withdraw your consent at any time by reopening the cookie settings via the link or button available on this website.
  </p>

  <h3>5. Strictly Necessary Cookies</h3>
  <p>These cookies are essential for the website to function properly and cannot be disabled. They do not require your consent.</p>

  <div class="table-wrapper">
    <table class="policy-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Purpose</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>consent_status</strong></td>
          <td>Stores your general cookie consent choice.</td>
          <td>30 days</td>
        </tr>
        <tr>
          <td><strong>consent_choices</strong></td>
          <td>Stores detailed cookie category preferences.</td>
          <td>30 days</td>
        </tr>
        <tr>
          <td><strong>client_consent_id</strong></td>
          <td>A unique, anonymous ID used to audit compliance and prove that valid consent was given.</td>
          <td>365 days</td>
        </tr>
      </tbody>
    </table>
  </div>
      
  <h3>6. Optional cookies and third-party services</h3>
  <p>
    With your consent, this website may use third-party services such as analytics or marketing tools. These cookies are used to understand how visitors interact with the website and to improve its functionality and content.
  </p>

  <div class="table-wrapper">
    <table class="policy-table">
      <thead>
        <tr>
          <th>Service</th>
          <th>Category</th>
          <th>Purpose</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Google Analytics</td>
          <td>Analytics</td>
          <td>Collects information about website usage to help improve performance and user experience.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h3>7. Google Consent Mode</h3>
  <p>
    This website uses Google Consent Mode to ensure that Google services respect your consent choices. Depending on your selection, Google tags may adjust their behavior accordingly.
  </p>

  <h3>8. Data controller</h3>
  <p>
    The website operator is the data controller for the processing of personal data on this website.
  </p>
  <p>
    For information about how to contact the website operator, please refer to the contact details provided on this website.
  </p>

  <h3>9. Updates to this policy</h3>
  <p>
    This Cookie Policy may be updated to reflect changes in legal requirements or our use of cookies.
  </p>

  <div class="policy-footer-note">
    <p>This policy applies from ${today}.</p>
    <p>Current version: ${CURRENT_POLICY_VERSION}</p>
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
