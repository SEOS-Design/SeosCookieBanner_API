import * as z from "zod";
import { zValidator } from "@hono/zod-validator";

export const consentSchema = z.object({
  necessary: z.boolean(),
  analytics: z.boolean(),
  marketing: z.boolean(),
  functional: z.boolean(),
  client_id: z.string().uuid(),
  domain: z.string().min(1),
  status: z.enum(["all", "necessary_only", "custom"]),
  timestamp: z.string(),
  policyVersion: z.string().optional(),
  userAgent: z.string().optional(),
});

export type ConsentPayload = z.infer<typeof consentSchema>;
export type ConsentStatus = ConsentPayload["status"];

export const consentValidator = zValidator("json", consentSchema);
