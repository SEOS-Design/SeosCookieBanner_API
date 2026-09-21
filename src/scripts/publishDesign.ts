import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { websites } from "../db/schema";
import { DESIGN_VARIABLES, GEOMETRY_VARIABLES } from "../lib/designVariables";
import { parseVariables as lasVariabler } from "../lib/designFile";

/**
 * Publicerar en sajts designvarden fran design/ till databasen.
 *
 *   Torrkorning:  npm run publish-design -- --site=brevenshus
 *   Skarpt:       npm run publish-design -- --site=brevenshus --run
 *   Se laget:     npm run publish-design -- --status
 *
 * FILEN AR SANNINGEN, DATABASEN AR KOPIAN. Samma regel som for policyer, och
 * av samma skal: en gang lag den svenska policytexten bara i databasen och
 * aldrig i repot, och seed-skriptet hade kvar gammal engelsk text. Ligger
 * designen bara i databasen vet repot inte hur nagon kunds banner ser ut, det
 * finns ingen historik over vem som andrade vad, och ingen diff att granska.
 *
 * Darfor skrivs designen som VANLIG CSS:
 *
 *   design/brevenshus.css
 *   :root {
 *     --bg-main: #efe1c9;
 *     --radius-md: 24px;
 *   }
 *
 * Det gor ocksa migreringen riskfri: att flytta en befintlig kund ar att
 * kopiera deras designblock rakt in i filen. Ingen avskrift, inga felstavade
 * hex-koder.
 *
 * ⚠️ Bygger ni senare ett admin-granssnitt (D4) maste det skriva TILLBAKA
 * till filen, annars driver fil och databas isar.
 */

//========================================================================
// VILKA VARIABLER SOM FAR SATTAS
//========================================================================
//
// Designmodellen: GEOMETRI lika pa alla sajter, VARUMARKE per sajt. Bannern
// ska kannas som samma komponent overallt men bara kundens uttryck.
//
// Listan ar med flit densamma som i routes/config.ts och i bannerns
// DESIGN_VARIABLES. Att den star har OCKSA ar poangen med det har skriptet:
// felet upptacks nar du publicerar, med ett tydligt meddelande - i stallet
// for att vardet tyst faller bort nagonstans langre fram.
const ALLOWED = DESIGN_VARIABLES;

// Geometri namns sarskilt for att felmeddelandet ska kunna forklara VARFOR,
// i stallet for att bara saga "okand variabel".
const GEOMETRY = GEOMETRY_VARIABLES;

const MAX_VALUE_LENGTH = 200;
// Samma sparr som i API:t: ett CSS-varde med url() far webblasaren att hamta
// nagot fran en adress vi inte valt.
const UNSAFE_VALUE = /url\(|expression\(|javascript:|@import|[<>{}\\;]/i;

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const toShortName = (domain: string): string => domain.replace(/^www\./, "").split(".")[0]!;

// parseVariables bor i lib/designFile.ts sedan 2026-09-18, sa panelen och
// publiceringen laser filen pa exakt samma satt.
export { parseVariables } from "../lib/designFile";

const run = async () => {
  const site = arg("site");
  // --run ar den dokumenterade flaggan. --kor accepteras ocksa, eftersom
  // aterstallningsskriptet anvander den och muskelminnet inte ska straffas.
  const run = hasFlag("run") || hasFlag("kor");
  const status = hasFlag("status");

  const allSites = await db.query.websites.findMany({
    columns: { id: true, name: true, domain: true, design: true },
  });

  if (status) {
    console.log("\nDesign per sajt (databasen):\n");
    for (const s of allSites) {
      const count = Object.keys(s.design ?? {}).length;
      const file = join("design", `${toShortName(s.domain)}.css`);
      console.log(
        `  ${toShortName(s.domain).padEnd(14)} ${String(count).padStart(2)} variabler   ` +
          `${existsSync(file) ? file : "(ingen fil)"}`,
      );
    }
    console.log(
      "\n  0 variabler = sajten kor bannerns standardvarden. Det ar inget fel.\n",
    );
    process.exit(0);
  }

  if (!site) {
    console.error(
      "Anvandning:\n" +
        "  npm run publish-design -- --site=<kortnamn>          (torrkorning)\n" +
        "  npm run publish-design -- --site=<kortnamn> --run    (skarpt)\n" +
        "  npm run publish-design -- --status",
    );
    process.exit(1);
  }

  const website = allSites.find((s) => toShortName(s.domain) === site);
  if (!website) {
    console.error(
      `Hittade ingen sajt som matchar '${site}'. ` +
        `Tillgangliga: ${allSites.map((s) => toShortName(s.domain)).join(", ")}`,
    );
    process.exit(1);
  }

  const path = join("design", `${site}.css`);
  if (!existsSync(path)) {
    console.error(
      `Filen ${path} finns inte.\n\n` +
        `Skapa den med sajtens variabler:\n\n` +
        `  :root {\n    --bg-main: #efe1c9;\n    --radius-md: 24px;\n  }\n\n` +
        `Ska sajten kora bannerns standardvarden behovs ingen fil alls.`,
    );
    process.exit(1);
  }

  const found = lasVariabler(readFileSync(path, "utf8"));
  const design: Record<string, string> = {};
  const issues: string[] = [];

  for (const [name, value] of Object.entries(found)) {
    if (GEOMETRY.has(name)) {
      issues.push(
        `  --${name}: geometri gar inte att satta per sajt.\n` +
          `      Bannern ska kannas som samma komponent pa alla sajter. Ser storleken\n` +
          `      fel ut ska BASVARDET rattas i banner-src/style.css - da nar andringen\n` +
          `      alla sajter. Satts vardet har nar framtida basandringar aldrig fram.`,
      );
      continue;
    }
    if (!ALLOWED.has(name)) {
      issues.push(`  --${name}: okand variabel, hoppas over.`);
      continue;
    }
    if (value.length > MAX_VALUE_LENGTH) {
      issues.push(`  --${name}: vardet ar langre an ${MAX_VALUE_LENGTH} tecken.`);
      continue;
    }
    if (UNSAFE_VALUE.test(value)) {
      issues.push(
        `  --${name}: vardet innehaller url() eller liknande. Ett CSS-varde som\n` +
          `      hamtar nagot fran en adress vi inte valt ar en vag att spara besokare.`,
      );
      continue;
    }
    design[name] = value;
  }

  const current = (website.design ?? {}) as Record<string, string>;
  const keys = new Set([...Object.keys(current), ...Object.keys(design)]);
  const changes: string[] = [];
  for (const n of [...keys].sort()) {
    const fran = current[n];
    const till = design[n];
    if (fran === till) continue;
    if (fran === undefined) changes.push(`  + --${n}: ${till}`);
    else if (till === undefined) changes.push(`  - --${n}  (togs bort, ${fran})`);
    else changes.push(`  ~ --${n}: ${fran}  ->  ${till}`);
  }

  console.log(`\n${website.domain}   ${path}\n`);

  if (issues.length) {
    console.log("Hoppade over:\n" + issues.join("\n") + "\n");
  }

  if (!changes.length) {
    console.log("Ingen skillnad mot databasen. Ingenting att gora.\n");
    process.exit(0);
  }

  console.log(`${changes.length} andringar:\n` + changes.join("\n") + "\n");

  if (!run) {
    console.log(
      "Torrkorning - ingenting skrivet. Lagg till --run nar du sett att det stammer.\n" +
        "OBS: vardena satts som inline style pa bannern och VINNER over kundens\n" +
        "designblock. En andring syns alltsa direkt hos kunden.\n",
    );
    process.exit(0);
  }

  await db.update(websites).set({ design }).where(eq(websites.id, website.id));

  console.log(
    "Skrivet till databasen.\n\n" +
      "SA HAR SER DU DET:\n" +
      `  Direkt, for dig    Oppna sajten med ?seos_preview pa slutet:\n` +
      `                     https://${website.domain}/?seos_preview\n\n` +
      "  Direkt, for ALLA   Redeploya API:t i Vercel (Deployments -> senaste\n" +
      "                     -> Redeploy). CDN:et cachar per deployment, sa en ny\n" +
      "                     deployment gor att gamla sparade svar slutar anvandas.\n\n" +
      "  Av sig sjalvt      Inom sex timmar. Gor ingenting.\n\n" +
      "Verifiera pa den RIKTIGA sajten, inte i en testsida - bannern hamtar\n" +
      "typsnitt, och darmed textbredder, fran sidan omkring sig.\n",
  );
  process.exit(0);
};

// Kor bara nar filen startas direkt. Utan den har vakten oppnar en import av
// parseVariables() en databasanslutning och kor hela publiceringen - vilket gor
// tolken omojlig att testa separat.
if (require.main === module) {
  run().catch((error) => {
    console.error("Publiceringen misslyckades:", error);
    process.exit(1);
  });
}
