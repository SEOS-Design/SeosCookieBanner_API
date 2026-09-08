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
  //
  // ⚠️ .nullish() OCH INTE .optional(). Skillnaden ar inte kosmetisk:
  // .optional() tillater att faltet SAKNAS, men avvisar null. Bannern bygger
  // sin payload med site_key: SITE_KEY, och SITE_KEY ar null nar scripttaggen
  // saknar data-site-key - JSON.stringify tar da med "site_key": null.
  //
  // Det inforde ett tyst produktionsfel 2026-07-28: tillvaxtstod kor den
  // gamla bannerfilen utan nyckel i taggen, och varje samtycke darifran
  // avvisades med 400 i SEX VECKOR innan nagon markte det. Omkring 1700
  // samtycken gick forlorade och gar inte att aterskapa.
  //
  // Null maste accepteras sa lange nagon kund kan kora en banner utan nyckel.
  // Uppslaget i routes/consent.ts faller tillbaka pa domain, och null ar
  // falsy - sa den fallbacken fungerar oforandrat.
  site_key: z.string().min(8).max(64).nullish(),
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
