import { Hono } from "hono";
import type { ConsentPayload } from "../types/consent";

export const consentRoute = new Hono();

consentRoute.post("/", async (c) => {
  const body = (await c.req.json()) as ConsentPayload;

  console.log("Consent recieved:", body);

  return c.json({ ok: true });
});
