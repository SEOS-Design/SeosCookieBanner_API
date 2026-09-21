import "dotenv/config";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { websites, policyVersion } from "../db/schema";
import { choosePolicyFile } from "../lib/policyFile";

/**
 * Publicerar policytexter fran policies/ till databasen.
 *
 *   Provkorning:  npm run publish-policy -- --site=tillvaxtstod --version=1.0.3
 *   Skarpt:       npm run publish-policy -- --site=tillvaxtstod --version=1.0.3 --run
 *   Alla:         npm run publish-policy -- --all --version=1.0.4 [--run]
 *
 * PROVKORNING AR STANDARD sedan 2026-09-21, som i publish-design och
 * publish-texts. Forut publicerade kommandot direkt - och en publicerad
 * version gar aldrig att ta tillbaka.
 *
 * REGELN (lib/policyFile.ts):
 *   Sajt MED egen variant    ->  policies/<sajt>/<version>.html, annars hoppas den over
 *   Sajt UTAN egen variant   ->  policies/base/<version>.html
 *
 * En sajt med egen variant far ALDRIG basmallen som reserv - den hade tappat
 * sina egna tillagg, for tillvaxtstod texten om Meta-pixeln. Det var sa
 * kommandot betedde sig fram till 2026-09-21.
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

/** Versionerna i policies/<sajt>/, eller null om mappen inte finns. */
const ownVersions = (domain: string): string[] | null => {
  const dir = join("policies", toShortName(domain));
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((name) => name.endsWith(".html"))
    .map((name) => name.slice(0, -".html".length));
};

const run = async () => {
  const version = arg("version");
  const site = arg("site");
  const all = hasFlag("all");
  const live = hasFlag("run");

  if (!version || (!site && !all)) {
    console.error(
      "Anvandning:\n" +
        "  npm run publish-policy -- --site=<kortnamn> --version=<x.y.z>          (provkorning)\n" +
        "  npm run publish-policy -- --site=<kortnamn> --version=<x.y.z> --run    (skarpt)\n" +
        "  npm run publish-policy -- --all --version=<x.y.z> [--run]",
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
    const choice = choosePolicyFile({
      site: toShortName(s.domain),
      version,
      ownVersions: ownVersions(s.domain),
      baseExists: existsSync(join("policies", "base", `${version}.html`)),
    });

    if (choice.kind === "skip") {
      console.log(`  HOPPAR  ${s.domain}`);
      console.log(`          ${choice.reason}`);
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

    const label = choice.kind === "own" ? "  (egen variant)" : "  (basmall)";

    if (!live) {
      console.log(`  SKULLE  ${s.domain}`);
      console.log(`          ${choice.path}${label}`);
      published++;
      continue;
    }

    const content = readFileSync(choice.path, "utf-8");
    await db.insert(policyVersion).values({
      website_id: s.id,
      version_label: version,
      content_html: content,
      valid_from: new Date(),
    });

    console.log(`  KLAR    ${s.domain}`);
    console.log(`          ${choice.path}${label}`);
    published++;
  }

  if (!live) {
    console.log(
      `\nProvkorning - ingenting publicerat. ${published} skulle publiceras, ${skipped} hoppas over.\n` +
        "Lagg till --run nar listan ovan stammer. En publicerad version gar aldrig att andra.",
    );
    process.exit(0);
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
