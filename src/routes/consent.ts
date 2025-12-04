import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
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
      `[Request] Consent from domain: ${body.domain}, client: ${body.client_id}`
    );

    // Hitta den anropande hemsidans ID
    const website = await db.query.websites.findFirst({
      where: eq(websites.domain, body.domain),
      columns: { id: true },
    });

    if (!website) {
      console.log(`[403] Domain not registered: ${body.domain}`);
      return c.json(
        { message: `Domain '${body.domain}' is not registered.` },
        403
      );
    }
    const websiteId = website.id;

    // Hämta alla kategorier för hemsidan
    const categoryRows = await db.query.consentCategory.findMany({
      where: eq(consentCategory.website_id, websiteId),
      columns: { id: true, key: true },
    });

    if (categoryRows.length === 0) {
      throw new Error(`No categories found for website ID: ${websiteId}`);
    }

    // Skapa Map för snabb översättning (key -> id)
    const categoryMap = new Map(categoryRows.map((cat) => [cat.key, cat.id]));

    // STARTA TRANSAKTIONEN
    const result = await db.transaction(async (tx) => {
      let userIdentity: Identity | undefined;

      // UPSERT IDENTITY (Hitta eller Skapa Användaren)
      const existingIdentity = await tx.query.identity.findFirst({
        where: and(
          eq(identity.client_id, body.client_id),
          eq(identity.website_id, websiteId)
        ),
      });

      if (existingIdentity) {
        userIdentity = existingIdentity;
        console.log(`[Identity] Found existing: ${userIdentity.id}`);
      } else {
        // Skapa ny rad (INSERT)
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

      // INSERT CONSENT_EVENT (Skapa händelsen)
      const [event] = await tx
        .insert(consentEvent)
        .values({
          website_id: websiteId,
          identity_id: identityId,
          event_type: body.status,
          user_agent: body.userAgent,
          policy_version_text: body.policyVersion,
        })
        .returning();

      if (!event) {
        throw new Error("Failed to create consent event.");
      }

      const consentEventId = event.id;
      console.log(`[Event] Created: ${consentEventId}`);

      // INSERT CONSENT_CHOICE (Skapa detaljerade val)
      const choicesToInsert = [];

      for (const key of CATEGORY_KEYS) {
        const categoryId = categoryMap.get(key);

        if (!categoryId) {
          console.log(
            `[Warning] Category '${key}' not found in database. Skipping.`
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
      `[Success] Consent recorded for ${body.domain}: Event ${result.consentEventId}`
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
      201
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
      500
    );
  }
});
