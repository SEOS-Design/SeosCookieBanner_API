import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { websites, policyVersion } from "../db/schema";

/**
 * Publicerar policytexter fran policies/ till databasen.
 *
 *   En sajt:    npm run publish-policy -- --site=tillvaxtstod --version=1.0.3
 *   Alla:       npm run publish-policy -- --all --version=1.0.4
 *
 * REGELN: en sajt anvander sin EGEN fil om den finns, annars basmallen.
 *   policies/<sajt>/<version>.html   ->  om den finns
 *   policies/base/<version>.html     ->  annars
 *
 * Publicerade versioner skrivs aldrig om. Varje consent_event pekar pa exakt
 * policy_version_id - andras en publicerad text ser det ut som att tidigare
 * besokare godkant nagot de aldrig fick se. Hoj versionsnumret i stallet.
 */

const arg = (namn: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${namn}=`))?.split("=").slice(1).join("=");

const harFlagga = (namn: string): boolean =>
  process.argv.includes(`--${namn}`);

// Kort namn for en sajt: www.tillvaxtstod.se -> tillvaxtstod
const kortNamn = (domain: string): string =>
  domain.replace(/^www\./, "").split(".")[0]!;

const hittaFil = (domain: string, version: string) => {
  const eget = join("policies", kortNamn(domain), `${version}.html`);
  if (existsSync(eget)) return { sokvag: eget, egen: true };
  const bas = join("policies", "base", `${version}.html`);
  if (existsSync(bas)) return { sokvag: bas, egen: false };
  return null;
};

const run = async () => {
  const version = arg("version");
  const site = arg("site");
  const alla = harFlagga("all");

  if (!version || (!site && !alla)) {
    console.error(
      "Anvandning:\n" +
        "  npm run publish-policy -- --site=<kortnamn> --version=<x.y.z>\n" +
        "  npm run publish-policy -- --all --version=<x.y.z>",
    );
    process.exit(1);
  }

  const allaSajter = await db.query.websites.findMany({
    columns: { id: true, name: true, domain: true },
  });

  const malsajter = alla
    ? allaSajter
    : allaSajter.filter((s) => kortNamn(s.domain) === site);

  if (malsajter.length === 0) {
    console.error(
      site
        ? `Hittade ingen sajt som matchar '${site}'. Tillgangliga: ${allaSajter.map((s) => kortNamn(s.domain)).join(", ")}`
        : "Inga sajter i databasen.",
    );
    process.exit(1);
  }

  let publicerade = 0;
  let hoppade = 0;

  for (const s of malsajter) {
    const fil = hittaFil(s.domain, version);

    if (!fil) {
      console.log(`  HOPPAR  ${s.domain}`);
      console.log(`          ingen fil for version ${version} (varken egen eller base)`);
      hoppade++;
      continue;
    }

    const finns = await db.query.policyVersion.findFirst({
      where: and(
        eq(policyVersion.website_id, s.id),
        eq(policyVersion.version_label, version),
      ),
      columns: { id: true },
    });

    if (finns) {
      console.log(`  HOPPAR  ${s.domain}`);
      console.log(`          version ${version} finns redan publicerad`);
      hoppade++;
      continue;
    }

    const content = readFileSync(fil.sokvag, "utf-8");
    await db.insert(policyVersion).values({
      website_id: s.id,
      version_label: version,
      content_html: content,
      valid_from: new Date(),
    });

    console.log(`  KLAR    ${s.domain}`);
    console.log(`          ${fil.sokvag}${fil.egen ? "  (egen variant)" : "  (basmall)"}`);
    publicerade++;
  }

  console.log(`\n${publicerade} publicerade, ${hoppade} hoppade.`);
  if (publicerade > 0) {
    console.log("Bannern serverar nu senaste versionen. Kontrollera med: npm run policy-status");
  }
  process.exit(0);
};

run().catch((e) => {
  console.error("Publicering misslyckades:", e.message);
  process.exit(1);
});
