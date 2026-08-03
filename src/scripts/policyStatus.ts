import "dotenv/config";
import { existsSync } from "fs";
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
    const harEgenMapp = existsSync(join("policies", kort));

    console.log(`${s.domain}  (${s.name})`);
    console.log(`  Aktiv version : ${aktiv ? aktiv.label : "SAKNAS - bannern kan inte visa policy!"}`);
    if (aktiv) {
      console.log(`  Publicerad    : ${aktiv.valid_from.toISOString().split("T")[0]}`);
    }
    console.log(`  Policykalla   : ${harEgenMapp ? `policies/${kort}/  (egen variant)` : "policies/base/  (basmall)"}`);
    if (versioner.length > 1) {
      console.log(`  Tidigare      : ${versioner.slice(1).map((v) => v.label).join(", ")}`);
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
