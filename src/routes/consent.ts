import { Hono } from "hono";
import {
  consentValidator,
  type ConsentPayload,
} from "../validators/consentValidator";
import { db } from "../db/client";
import { websites } from "../db/schema";
import { identity } from "../db/schema";

export const consentRoute = new Hono();

consentRoute.post("/", consentValidator, async (c) => {
  try {
    const body = c.req.valid("json") as ConsentPayload;

    const result = await db.insert(consents).values({
      necessary: body.necessary,
      analytics: body.analytics,
      marketing: body.marketing,
      functional: body.functional,
      status: body.status,
      timestamp: body.timestamp,
      policyVersion: body.policyVersion,
      userAgent: body.userAgent,
    });

    console.log("Consent saved to database", result);

    return c.json(
      {
        ok: true,
        message: "Consent recorded successfully",
        data: result,
      },
      201
    );
  } catch (error) {
    console.error("Database insert failed:", error);

    return c.json(
      {
        ok: false,
        message: "Failed to record consent due to a server error",
      },
      500
    );
  }
});
