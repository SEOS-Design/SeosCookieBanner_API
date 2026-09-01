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

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const hasFlag = (name: string): boolean =>
  process.argv.includes(`--${name}`);

// Kort namn for en sajt: www.tillvaxtstod.se -> tillvaxtstod
const toShortName = (domain: string): string =>
  domain.replace(/^www\./, "").split(".")[0]!;

const findFile = (domain: string, version: string) => {
  const eget = join("policies", toShortName(domain), `${version}.html`);
  if (existsSync(eget)) return { path: eget, egen: true };
  const base = join("policies", "base", `${version}.html`);
  if (existsSync(base)) return { path: base, egen: false };
  return null;
};

const run = async () => {
  const version = arg("version");
  const site = arg("site");
  const all = hasFlag("all");

  if (!version || (!site && !all)) {
    console.error(
      "Anvandning:\n" +
        "  npm run publish-policy -- --site=<kortnamn> --version=<x.y.z>\n" +
        "  npm run publish-policy -- --all --version=<x.y.z>",
    );
    process.exit(1);
  }

  const allSites = await db.query.websites.findMany({
    columns: { id: true, name: true, domain: true },
  });

  const targetSites = all
    ? allSites
    : allSites.filter((s) => toShortName(s.domain) === site);

  if (targetSites.length === 0) {
    console.error(
      site
        ? `Hittade ingen sajt som matchar '${site}'. Tillgangliga: ${allSites.map((s) => toShortName(s.domain)).join(", ")}`
        : "Inga sajter i databasen.",
    );
    process.exit(1);
  }

  let published = 0;
  let skipped = 0;

  for (const s of targetSites) {
    const file = findFile(s.domain, version);

    if (!file) {
      console.log(`  HOPPAR  ${s.domain}`);
      console.log(`          ingen fil for version ${version} (varken egen eller base)`);
      skipped++;
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
      skipped++;
      continue;
    }

    const content = readFileSync(file.path, "utf-8");
    await db.insert(policyVersion).values({
      website_id: s.id,
      version_label: version,
      content_html: content,
      valid_from: new Date(),
    });

    console.log(`  KLAR    ${s.domain}`);
    console.log(`          ${file.path}${file.egen ? "  (egen variant)" : "  (basmall)"}`);
    published++;
  }

  console.log(`\n${published} publicerade, ${skipped} hoppade.`);
  if (published > 0) {
    console.log("Bannern serverar nu senaste versionen. Kontrollera med: npm run policy-status");
  }
  process.exit(0);
};

run().catch((e) => {
  console.error("Publicering misslyckades:", e.message);
  process.exit(1);
});
