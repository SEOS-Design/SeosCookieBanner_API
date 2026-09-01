import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

export const cronRoute = new Hono();

/**
 * Gallring av bevisloggen (B7).
 *
 * Beslut 2026-08-18, motiverat i COOKIES-OCH-SAMTYCKE-OVERSIKT.md:
 *   - Samtyckesrader raderas efter 12 manader. Efter 365 dagar har cookien
 *     client_consent_id lopt ut och besokaren fatt ett nytt UUID - raden gar da
 *     inte att koppla till nagon, inte ens av dem sjalva. Lagringsminimering
 *     enligt art. 5.1 e.
 *   - Policyversioner raderas ALDRIG. De bar den systemiska bevisningen: exakt
 *     vilken text som visades nar. Utan dem kan vi inte visa vad nagon godkant.
 *
 * Kors av Vercel Cron en gang per dygn (Hobby tillater inte tatare).
 */
const RETENTION_PERIOD = "12 months";

/**
 * Sakerhetssparr. Ett jobb vars enda uppgift ar att radera maste vagra gora
 * nagot orimligt - en bugg i intervallet ("12 minutes" i stallet for
 * "12 months") skulle annars tomma hela bevisloggen pa en natt.
 *
 * Vid 12 manaders gallring och jamn trafik raderas ungefar en trehundradel av
 * raderna per korning. Traffas den har gransen ar nagot fel, och da ar ratt
 * beteende att avbryta och larma - inte att fortsatta.
 */
const MAX_SHARE = 0.5;

type Resultat = {
  dryRun: boolean;
  gallringstid: string;
  raderDessforinnan: number;
  raderAttGallra: number;
  raderadeEvents: number;
  raderadeIdentiteter: number;
  avbruten?: string;
};

cronRoute.get("/gallra", async (c) => {
  // Vercel skickar Authorization: Bearer <CRON_SECRET> nar variabeln ar satt.
  // Saknas den vagrar vi kora - hellre en trasig cron som syns an en oppen
  // raderingsendpoint som inte gor det.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[Gallring] CRON_SECRET saknas - endpointen ar avstangd.");
    return c.json({ message: "Cron secret not configured." }, 500);
  }
  if (c.req.header("authorization") !== `Bearer ${secret}`) {
    return c.json({ message: "Unauthorized." }, 401);
  }

  const dryRun = c.req.query("dryRun") === "1";

  try {
    const totalRows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM consent_event`,
    );
    const pruneRow = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM consent_event
          WHERE created_at < now() - ${sql.raw(`interval '${RETENTION_PERIOD}'`)}`,
    );

    const total = Number(totalRows.rows[0]?.n ?? 0);
    const toPrune = Number(pruneRow.rows[0]?.n ?? 0);

    const result: Resultat = {
      dryRun,
      gallringstid: RETENTION_PERIOD,
      raderDessforinnan: total,
      raderAttGallra: toPrune,
      raderadeEvents: 0,
      raderadeIdentiteter: 0,
    };

    if (toPrune === 0) {
      console.log("[Gallring] Inget att gallra.");
      return c.json(result);
    }

    if (total > 0 && toPrune / total > MAX_SHARE) {
      result.avbruten = `Skulle radera ${toPrune} av ${total} rader (over ${MAX_SHARE * 100} %). Avbryter - kontrollera gallringstiden.`;
      console.error("[Gallring] AVBRUTEN:", result.avbruten);
      return c.json(result, 500);
    }

    if (dryRun) {
      console.log(`[Gallring] Torrkorning: ${toPrune} rader skulle raderas.`);
      return c.json(result);
    }

    // consent_choice foljer med via ON DELETE CASCADE.
    const events = await db.execute(
      sql`DELETE FROM consent_event
          WHERE created_at < now() - ${sql.raw(`interval '${RETENTION_PERIOD}'`)}`,
    );

    // Identiteter utan kvarvarande handelser fyller ingen funktion langre.
    const identities = await db.execute(
      sql`DELETE FROM identity i
          WHERE NOT EXISTS (SELECT 1 FROM consent_event e WHERE e.identity_id = i.id)`,
    );

    result.raderadeEvents = events.rowCount ?? 0;
    result.raderadeIdentiteter = identities.rowCount ?? 0;

    console.log(
      `[Gallring] Raderade ${result.raderadeEvents} handelser och ${result.raderadeIdentiteter} identiteter.`,
    );
    return c.json(result);
  } catch (error) {
    console.error("[Gallring] Misslyckades:", error);
    return c.json({ message: "Gallring failed." }, 500);
  }
});
