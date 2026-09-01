import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { gzipSync } from "node:zlib";
import { put, list, del } from "@vercel/blob";
import { db } from "../db/client";

export const backupRoute = new Hono();

/**
 * Nattlig sakerhetskopia av databasen (B5).
 *
 * VARFOR: Neons gratisplan har ett aterstallningsfonster pa ca sex timmar. Ett
 * misstag som upptacks nasta morgon gar da inte att backa. Bevisloggen ar
 * produktens varde och finns i ett enda exemplar - den gar inte att aterskapa.
 * En kopia utanfor Neon skyddar dessutom mot att sjalva Neon-kontot gar
 * forlorat, vilket ingen aterstallning inuti Neon gor.
 *
 * VARFOR JSON OCH INTE pg_dump: en serverless-funktion kan inte kora pg_dump.
 * Alternativet hade varit GitHub Actions, men da maste databasens
 * anslutningsstrang ligga som hemlighet i ett publikt repo. Kors jobbet inifran
 * Vercel behovs ingen ny nyckel alls - DATABASE_URL finns redan har, och Blob
 * autentiserar via OIDC. Tabellerna ar enkla nog att JSON aterstaller dem
 * troget, och formatet ar dessutom lattare att plocka enstaka rader ur.
 *
 * Kors av Vercel Cron 02:00 UTC, alltsa fore gallringen 03:00 - kopian ska
 * innehalla det som strax raderas.
 */

/** Beslut 2026-08-18: kopior behalls 30 dagar. Maste vara KORTARE an
 *  gallringstiden pa 12 manader, annars ligger raderad data kvar i kopiorna
 *  och gallringen ar ett tomt lofte. */
const KEEP_DAYS = 30;

const PREFIX = "backup/";

/**
 * Tabellerna i den ordning de maste aterstallas - foreign keys pekar bakat.
 * Andras ordningen gar en aterstallning inte att genomfora.
 */
const TABLES = [
  "websites",
  "consent_category",
  "policy_version",
  "identity",
  "consent_event",
  "consent_choice",
] as const;

backupRoute.get("/backup", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[Backup] CRON_SECRET saknas - endpointen ar avstangd.");
    return c.json({ message: "Cron secret not configured." }, 500);
  }
  if (c.req.header("authorization") !== `Bearer ${secret}`) {
    return c.json({ message: "Unauthorized." }, 401);
  }

  const dryRun = c.req.query("dryRun") === "1";

  try {
    const tables: Record<string, unknown[]> = {};
    const count: Record<string, number> = {};

    for (const table of TABLES) {
      const rows = await db.execute(sql`SELECT * FROM ${sql.identifier(table)}`);
      tables[table] = rows.rows;
      count[table] = rows.rows.length;
    }

    // En kopia utan bevisloggen ar inte en kopia. Hellre avbryta an att skriva
    // en tom fil som ser ut som ett skyddsnat.
    if ((count["consent_event"] ?? 0) === 0) {
      console.error("[Backup] AVBRUTEN: consent_event ar tom - skriver ingen kopia.");
      return c.json({ message: "Refusing to write an empty backup.", count }, 500);
    }

    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${PREFIX}${date}.json.gz`;

    const content = gzipSync(
      Buffer.from(
        JSON.stringify({
          skapad: new Date().toISOString(),
          format: 1,
          aterstallningsordning: TABLES,
          count,
          tables,
        }),
      ),
    );

    if (dryRun) {
      console.log(`[Backup] Torrkorning: ${fileName}, ${content.byteLength} byte.`);
      return c.json({ dryRun: true, fileName, storlek: content.byteLength, count });
    }

    // allowOverwrite sa att en omkorning samma dygn ersatter dagens fil i
    // stallet for att faila.
    const blob = await put(fileName, content, {
      access: "private",
      contentType: "application/gzip",
      allowOverwrite: true,
    });

    // Gallra gamla kopior. Radering ar gratis hos Blob.
    const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    const { blobs } = await list({ prefix: PREFIX });
    const old = blobs.filter((b) => new Date(b.uploadedAt).getTime() < limit);
    if (old.length > 0) await del(old.map((b) => b.url));

    console.log(
      `[Backup] Skrev ${fileName} (${content.byteLength} byte). Raderade ${old.length} gamla kopior. Totalt ${blobs.length - old.length + 1} kvar.`,
    );

    return c.json({
      dryRun: false,
      fileName,
      storlek: content.byteLength,
      count,
      raderadeGamla: old.length,
      kopiorKvar: blobs.length - old.length + 1,
      pathname: blob.pathname,
    });
  } catch (error) {
    console.error("[Backup] Misslyckades:", error);
    return c.json({ message: "Backup failed.", error: String(error) }, 500);
  }
});
