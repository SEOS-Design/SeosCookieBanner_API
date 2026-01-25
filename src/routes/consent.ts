import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import {
  consentValidator,
  type ConsentPayload,
} from "../validators/consentValidator";
import { db } from "../db/client";
import {
  websites,
  identity,
  consentCategory,
  consentEvent,
  consentChoice,
  type NewIdentity,
  type Identity,
  policyVersion,
} from "../db/schema";

const CATEGORY_KEYS = [
  "necessary",
  "functional",
  "analytics",
  "marketing",
] as const;

export const consentRoute = new Hono();

consentRoute.post("/", consentValidator, async (c) => {
  try {
    const body = c.req.valid("json") as ConsentPayload;

    console.log(
      `[Request] Consent from domain: ${body.domain}, client: ${body.client_id}`,
    );

    // Find the ID of the website
    const website = await db.query.websites.findFirst({
      where: eq(websites.domain, body.domain),
      columns: { id: true },
    });

    if (!website) {
      console.log(`[403] Domain not registered: ${body.domain}`);
      return c.json(
        { message: `Domain '${body.domain}' is not registered.` },
        403,
      );
    }
    const websiteId = website.id;

    // Find all categories for the website
    const categoryRows = await db.query.consentCategory.findMany({
      where: eq(consentCategory.website_id, websiteId),
      columns: { id: true, key: true },
    });

    if (categoryRows.length === 0) {
      throw new Error(`No categories found for website ID: ${websiteId}`);
    }

    // create map for translating key -> id
    const categoryMap = new Map(categoryRows.map((cat) => [cat.key, cat.id]));

    // Find active policyversion
    const policyResult = await db
      .select({ id: policyVersion.id })
      .from(policyVersion)
      .where(eq(policyVersion.website_id, websiteId))
      .orderBy(desc(policyVersion.valid_from))
      .limit(1);

    const policyVersionId = policyResult[0]?.id;

    if (!policyVersionId) {
      return c.json(
        { message: "Missing active policy version for this domain" },
        500,
      );
    }

    // START TRANSACTION
    const result = await db.transaction(async (tx) => {
      let userIdentity: Identity | undefined;

      // UPSERT IDENTITY (find or create user)
      const existingIdentity = await tx.query.identity.findFirst({
        where: and(
          eq(identity.client_id, body.client_id),
          eq(identity.website_id, websiteId),
        ),
      });

      if (existingIdentity) {
        userIdentity = existingIdentity;
        console.log(`[Identity] Found existing: ${userIdentity.id}`);
      } else {
        // create new row (INSERT)
        const newIdentityData: NewIdentity = {
          website_id: websiteId,
          client_id: body.client_id,
        };
        const [newIdentity] = await tx
          .insert(identity)
          .values(newIdentityData)
          .returning();

        if (!newIdentity) {
          throw new Error("Identity insertion failed unexpectedly.");
        }
        userIdentity = newIdentity;
        console.log(`[Identity] Created new: ${userIdentity.id}`);
      }

      const identityId = userIdentity.id;

      // INSERT CONSENT_EVENT (create event)
      const [event] = await tx
        .insert(consentEvent)
        .values({
          website_id: websiteId,
          identity_id: identityId,
          event_type: body.status,
          user_agent: body.userAgent,
          policy_version_id: policyVersionId,
        })
        .returning();

      if (!event) {
        throw new Error("Failed to create consent event.");
      }

      const consentEventId = event.id;
      console.log(`[Event] Created: ${consentEventId}`);

      // INSERT CONSENT_CHOICE (Skapa detailed choices)
      const choicesToInsert = [];

      for (const key of CATEGORY_KEYS) {
        const categoryId = categoryMap.get(key);

        if (!categoryId) {
          console.log(
            `[Warning] Category '${key}' not found in database. Skipping.`,
          );
          continue;
        }

        choicesToInsert.push({
          consent_event_id: consentEventId,
          consent_category_id: categoryId,
          status: body[key] as boolean,
        });
      }

      if (choicesToInsert.length > 0) {
        await tx.insert(consentChoice).values(choicesToInsert);
        console.log(`[Choices] Recorded ${choicesToInsert.length} choices`);
      }

      return {
        consentEventId,
        identityId,
        choicesCount: choicesToInsert.length,
      };
    });

    console.log(
      `[Success] Consent recorded for ${body.domain}: Event ${result.consentEventId}`,
    );

    return c.json(
      {
        ok: true,
        message: "Consent recorded successfully",
        data: {
          eventId: result.consentEventId,
          identityId: result.identityId,
          choicesRecorded: result.choicesCount,
          timestamp: new Date().toISOString(),
        },
      },
      201,
    );
  } catch (error) {
    console.error("[Error] Database transaction failed:", error);
    return c.json(
      {
        ok: false,
        message: "Server failed to record consent due to a database error.",
        error:
          process.env.NODE_ENV === "development" ? String(error) : undefined,
      },
      500,
    );
  }
});

consentRoute.get("/policy/latest", async (c) => {
  try {
    const domain = c.req.query("domain");

    if (!domain) {
      return c.json({ message: "domain query parameter missing." }, 400);
    }

    console.log(`[POLICY] Hämta policy för domän: ${domain}`);

    const websiteRow = await db
      .select({ id: websites.id })
      .from(websites)
      .where(eq(websites.domain, domain))
      .limit(1);

    if (!websiteRow[0]) {
      console.error(`[POLICY] Domän inte hittad i DB: ${domain}`);
      return c.json({ message: `Domain "${domain}" not found` }, 404);
    }

    const websiteId = websiteRow[0].id;
    console.log(`[POLICY] Website ID: ${websiteId}`);

    const latestPolicy = await db
      .select()
      .from(policyVersion)
      .where(eq(policyVersion.website_id, websiteId))
      .orderBy(desc(policyVersion.valid_from))
      .limit(1);

    if (!latestPolicy[0]) {
      console.error("[POLICY] Hittade ingen aktiv policyrad.");
      return c.json({ message: "No active policy found for this domain" }, 404);
    }
    console.log(`[POLICY] Laddade version: ${latestPolicy[0].version_label}`);

    return c.json({
      version: latestPolicy[0].version_label,
      content: latestPolicy[0].content_html,
    });
  } catch (error) {
    console.error("Policy retrieval error:", error);
    return c.json({ message: "Server error during retrieval" }, 500);
  }
});
