import "dotenv/config";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { websites, policyVersion } from "../db/schema";

/**
 * Visar vilken policy varje sajt faktiskt kor just nu.
 * Databasen ar sanningen - filerna i policies/ ar bara kallan.
 *
 *   npm run policy-status
 */

const toShortName = (domain: string): string =>
  domain.replace(/^www\./, "").split(".")[0]!;

const run = async () => {
  const siteRows = await db.query.websites.findMany({
    columns: { id: true, name: true, domain: true },
  });

  if (siteRows.length === 0) {
    console.log("Inga sajter i databasen.");
    process.exit(0);
  }

  console.log("\nPOLICYSTATUS\n");

  for (const s of siteRows.sort((a, b) => a.domain.localeCompare(b.domain))) {
    const versions = await db
      .select({
        label: policyVersion.version_label,
        valid_from: policyVersion.valid_from,
      })
      .from(policyVersion)
      .where(eq(policyVersion.website_id, s.id))
      .orderBy(desc(policyVersion.valid_from));

    const active = versions[0];
    const shortName = toShortName(s.domain);

    console.log(`${s.domain}  (${s.name})`);

    if (!active) {
      console.log("  Aktiv version : SAKNAS - bannern kan inte visa nagon policy!\n");
      continue;
    }

    // Vilken fil den PUBLICERADE versionen kom fran - samma upplosningsregel
    // som publishPolicy anvander. Kollar inte om mappen finns, utan vad som
    // faktiskt ligger ute.
    const ownFile = join("policies", shortName, `${active.label}.html`);
    const source = existsSync(ownFile)
      ? `policies/${shortName}/  (egen variant)`
      : `policies/base/  (basmall)`;

    console.log(`  Aktiv version : ${active.label}`);
    console.log(`  Publicerad    : ${active.valid_from.toISOString().split("T")[0]}`);
    console.log(`  Kalla         : ${source}`);

    if (versions.length > 1) {
      console.log(`  Tidigare      : ${versions.slice(1).map((v) => v.label).join(", ")}`);
    }

    // Finns fardiga filer som annu inte publicerats for den har sajten?
    const published = new Set(versions.map((v) => v.label));
    const unpublished: string[] = [];
    for (const folder of [shortName, "base"]) {
      const dir = join("policies", folder);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".html")) continue;
        const label = f.replace(/\.html$/, "");
        if (!published.has(label)) {
          unpublished.push(`${label} (policies/${folder}/)`);
        }
      }
    }
    if (unpublished.length > 0) {
      console.log(`  EJ PUBLICERAD : ${[...new Set(unpublished)].join(", ")}`);
    }

    console.log("");
  }

  console.log("Uppdatera en sajt : npm run publish-policy -- --site=<kortnamn> --version=<x.y.z>");
  console.log("Uppdatera alla    : npm run publish-policy -- --all --version=<x.y.z>\n");
  process.exit(0);
};

run().catch((e) => {
  console.error("Kunde inte hamta status:", e.message);
  process.exit(1);
});
