import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { db } from "../db/client";
import { findQuietSites, QUIET_HOURS } from "../lib/consentVolume";

export const monitorRoute = new Hono();

/**
 * Volymlarmet (D3). Anropas av Uptime-workflowen i .github/workflows/uptime.yml.
 *
 * LASER BARA. Svarar med senaste samtycke per sajt och vilka som varit tysta
 * langre an QUIET_HOURS. Regeln ligger i lib/consentVolume.ts.
 *
 * EGEN NYCKEL, MONITOR_SECRET - INTE CRON_SECRET. CRON_SECRET oppnar aven
 * gallringen, som raderar. Lacker den har nyckeln kan nagon se nar sajterna
 * senast sparade ett samtycke, inget mer: inga personuppgifter, ingen skrivning.
 *
 * Vacker ingen extra databas: workflowen anropar den i samma korning som redan
 * vacker Neon via /consent/policy/latest.
 */

function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  // timingSafeEqual kraver lika langd - annars kastar den.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

monitorRoute.get("/consent-volume", async (c) => {
  // Ett cachat svar vore ett larm som ljuger.
  c.header("Cache-Control", "no-store");

  const secret = process.env.MONITOR_SECRET;
  if (!secret) {
    console.error("[Monitor] MONITOR_SECRET saknas - endpointen ar avstangd.");
    return c.json({ message: "Monitor secret not configured." }, 500);
  }
  if (!isAuthorized(c.req.header("authorization"), secret)) {
    return c.json({ message: "Unauthorized." }, 401);
  }

  try {
    // Delfragan gar pa indexet (website_id, created_at) och laser en rad per sajt.
    const rows = await db.execute<{ domain: string; last_consent_at: string | Date | null }>(
      sql`SELECT w.domain,
                 (SELECT max(e.created_at) FROM consent_event e WHERE e.website_id = w.id) AS last_consent_at
            FROM websites w
           ORDER BY w.domain`,
    );

    const sites = rows.rows.map((row) => ({
      domain: row.domain,
      lastConsentAt: row.last_consent_at ? new Date(row.last_consent_at) : null,
    }));
    const quiet = findQuietSites(sites, new Date());

    if (quiet.length > 0) {
      console.error(`[Monitor] Tysta sajter: ${quiet.map((q) => q.domain).join(", ")}`);
    }

    return c.json({
      quietHours: QUIET_HOURS,
      checked: sites.length,
      quiet,
      sites: sites.map((s) => ({
        domain: s.domain,
        lastConsentAt: s.lastConsentAt ? s.lastConsentAt.toISOString() : null,
      })),
    });
  } catch (error) {
    console.error("[Monitor] Misslyckades:", error);
    return c.json({ message: "Monitor failed." }, 500);
  }
});
