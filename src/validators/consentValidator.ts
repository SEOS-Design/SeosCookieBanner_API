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
  site_key: z.string().min(8).max(64).optional(),
  // Max langd for ett hostname enligt DNS.
  domain: z.string().min(1).max(253),
  status: z.enum(["all", "necessary_only", "custom"]),
  timestamp: z.string().max(64),
  // Kapas i stallet for att avvisas: ett ovanligt langt varde ska inte gora
  // att ett giltigt samtycke aldrig hamnar i bevisloggen. Absurda payloads
  // avvisas dock innan de nar databasen.
  userAgent: z
    .string()
    .max(4096)
    .transform((s) => s.slice(0, 512))
    .optional(),
});

export type ConsentPayload = z.infer<typeof consentSchema>;
export type ConsentStatus = ConsentPayload["status"];

export const consentValidator = zValidator("json", consentSchema);
