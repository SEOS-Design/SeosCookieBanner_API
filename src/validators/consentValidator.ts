import * as z from "zod";
import { zValidator } from "@hono/zod-validator";

export const consentSchema = z.object({
  necessary: z.boolean(),
  analytics: z.boolean(),
  marketing: z.boolean(),
  functional: z.boolean(),
  client_id: z.string().uuid(),
  // Sajten identifieras i forsta hand via site_key. Domain behalls under
  // overgangen for sajter vars scripttagg annu saknar nyckel.
  site_key: z.string().min(8).optional(),
  domain: z.string().min(1),
  status: z.enum(["all", "necessary_only", "custom"]),
  timestamp: z.string(),
  userAgent: z.string().optional(),
});

export type ConsentPayload = z.infer<typeof consentSchema>;
export type ConsentStatus = ConsentPayload["status"];

export const consentValidator = zValidator("json", consentSchema);
