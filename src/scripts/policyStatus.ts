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

const kortNamn = (domain: string): string =>
  domain.replace(/^www\./, "").split(".")[0]!;

const run = async () => {
  const sajter = await db.query.websites.findMany({
    columns: { id: true, name: true, domain: true },
  });

  if (sajter.length === 0) {
    console.log("Inga sajter i databasen.");
    process.exit(0);
  }

  console.log("\nPOLICYSTATUS\n");

  for (const s of sajter.sort((a, b) => a.domain.localeCompare(b.domain))) {
    const versioner = await db
      .select({
        label: policyVersion.version_label,
        valid_from: policyVersion.valid_from,
      })
      .from(policyVersion)
      .where(eq(policyVersion.website_id, s.id))
      .orderBy(desc(policyVersion.valid_from));

    const aktiv = versioner[0];
    const kort = kortNamn(s.domain);

    console.log(`${s.domain}  (${s.name})`);

    if (!aktiv) {
      console.log("  Aktiv version : SAKNAS - bannern kan inte visa nagon policy!\n");
      continue;
    }

    // Vilken fil den PUBLICERADE versionen kom fran - samma upplosningsregel
    // som publishPolicy anvander. Kollar inte om mappen finns, utan vad som
    // faktiskt ligger ute.
    const egenFil = join("policies", kort, `${aktiv.label}.html`);
    const kalla = existsSync(egenFil)
      ? `policies/${kort}/  (egen variant)`
      : `policies/base/  (basmall)`;

    console.log(`  Aktiv version : ${aktiv.label}`);
    console.log(`  Publicerad    : ${aktiv.valid_from.toISOString().split("T")[0]}`);
    console.log(`  Kalla         : ${kalla}`);

    if (versioner.length > 1) {
      console.log(`  Tidigare      : ${versioner.slice(1).map((v) => v.label).join(", ")}`);
    }

    // Finns fardiga filer som annu inte publicerats for den har sajten?
    const publicerade = new Set(versioner.map((v) => v.label));
    const opublicerade: string[] = [];
    for (const mapp of [kort, "base"]) {
      const dir = join("policies", mapp);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".html")) continue;
        const label = f.replace(/\.html$/, "");
        if (!publicerade.has(label)) {
          opublicerade.push(`${label} (policies/${mapp}/)`);
        }
      }
    }
    if (opublicerade.length > 0) {
      console.log(`  EJ PUBLICERAD : ${[...new Set(opublicerade)].join(", ")}`);
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
