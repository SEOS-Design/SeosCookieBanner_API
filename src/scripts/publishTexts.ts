import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { websites } from "../db/schema";

/**
 * Publicerar en sajts egna texter fran texts/ till databasen (C1 steg 3).
 *
 *   Torrkorning:  npm run publish-texts -- --site=brevenshus
 *   Skarpt:       npm run publish-texts -- --site=brevenshus --run
 *   Se laget:     npm run publish-texts -- --status
 *
 * FILEN AR SANNINGEN, DATABASEN AR KOPIAN. Samma regel som for design och
 * policyer, och Björns beslut 2026-08-31. Skalet ar konkret och kommer fran
 * det har projektet: den svenska policytexten lag en gang bara i databasen,
 * och seed-skriptet hade kvar gammal engelsk text. Ligger texten bara i
 * databasen finns ingen historik, ingen diff att granska och inget satt att se
 * hur en kunds banner ar tankt att lata.
 *
 * FORMEN, samma som i databasen sa det inte finns nagon oversattning:
 *
 *   texts/brevenshus.json
 *   {
 *     "sv": {
 *       "marketing": { "notice": "Brevens hus annonserar inte." }
 *     }
 *   }
 *
 * ALLT AR VALFRITT. Ett falt som saknas hamtas ur bannerns egen sprakabell, sa
 * en sajt kan byta ordalydelse pa en enda rubrik utan att fylla i nagot annat.
 *
 * ⚠️ REGLERNA LIGGER HAR, INTE I KOMMENTARER I JSON-FILEN. JSON kan inte ha
 * kommentarer, men det ar inte hela skalet: seed.ts skrev ut en inaktuell
 * instruktion om ALLOWED_ORIGINS i manader utan att nagon markte det.
 * Instruktioner i kod ruttnar. En kontroll som vagrar gor det inte.
 *
 * ⚠️ Bygger ni senare ett admin-granssnitt (D4) maste det skriva TILLBAKA till
 * filen, annars driver fil och databas isar. Samma villkor som for designen.
 */

//========================================================================
// VAD SOM FAR SATTAS
//========================================================================
//
// Listorna ar med flit KOPIOR av bannerns och API:ts. Att de star har OCKSA ar
// poangen med skriptet: felet upptacks nar du publicerar, med ett tydligt
// meddelande - i stallet for att vardet tyst faller bort langre fram.

const LANGUAGES = new Set(["sv", "en"]);
const CATEGORIES = ["necessary", "analytics", "functional", "marketing"] as const;
const FIELDS = new Set(["label", "description", "notice"]);

const MAX_TEXT_LENGTH = 300;

// Vinkelparenteser racker: allt annat som gor HTML farligt behover dem.
const UNSAFE_TEXT = /[<>]/;

/**
 * Bannerns egna texter, for att kunna saga ifran nar nagon skriver in nagot
 * som redan ar standard.
 *
 * ⚠️ KOPIA av banner-src/script.js. Driver de isar ar priset bara att en
 * varning uteblir - inget gar sonder, och ingen text blir fel. Fel at ratt
 * hall, samma resonemang som for de andra kopierade listorna.
 */
const BANNER_DEFAULTS: Record<string, Record<string, Record<string, string>>> = {
  sv: {
    necessary: {
      label: "Strikt nödvändiga",
      description: "Nödvändiga för att webbplatsen ska fungera korrekt.",
    },
    analytics: {
      label: "Analys och prestanda",
      description: "Hjälper oss förstå hur webbplatsen används.",
      notice: "Den här webbplatsen använder inga analyscookies.",
    },
    functional: {
      label: "Funktionella",
      description: "Kommer ihåg dina personliga inställningar.",
      notice: "Den här webbplatsen använder inga funktionella cookies.",
    },
    marketing: {
      label: "Marknadsföring",
      description: "Används för att visa relevanta annonser och spåra besökare.",
      notice: "Den här webbplatsen använder inga marknadsföringscookies.",
    },
  },
  en: {
    necessary: {
      label: "Strictly Necessary",
      description: "Essential for the website to function properly.",
    },
    analytics: {
      label: "Analytics and Performance",
      description: "Helps us understand how the website is used.",
      notice: "This website does not use any analytics cookies.",
    },
    functional: {
      label: "Functional",
      description: "Remembers your personal preferences.",
      notice: "This website does not use any functional cookies.",
    },
    marketing: {
      label: "Marketing",
      description: "Used to deliver relevant ads and track visitors.",
      notice: "This website does not use any marketing cookies.",
    },
  },
};

type Texts = Record<string, Record<string, Record<string, string>>>;

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const toShortName = (domain: string): string => domain.replace(/^www\./, "").split(".")[0]!;

/** Antalet ifyllda falt, over alla sprak och kategorier. */
export function countFields(texts: unknown): number {
  if (!texts || typeof texts !== "object") return 0;
  let total = 0;
  for (const categories of Object.values(texts as Texts)) {
    if (!categories || typeof categories !== "object") continue;
    for (const fields of Object.values(categories)) {
      if (!fields || typeof fields !== "object") continue;
      total += Object.keys(fields).length;
    }
  }
  return total;
}

/**
 * Ritar ut kategorikortet som det kommer se ut.
 *
 * Faltnamnen label/description/notice ar abstrakta, och ingen ska behova halla
 * i huvudet vilken RAD de landar pa. Kortet har tva rader: rubriken, och under
 * den antingen description (nar kategorin anvands) eller notice (nar den inte
 * gor det) - aldrig bada.
 */
function renderCard(
  lang: string,
  category: string,
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  const fallback = BANNER_DEFAULTS[lang]?.[category] ?? {};
  const rows: string[] = [];

  const show = (field: string, label: string) => {
    const f = before[field] ?? fallback[field];
    const t = after[field] ?? fallback[field];
    if (f === t) return;
    rows.push(`      ${label}`);
    rows.push(`        FORE:  ${f ?? "(ingen text)"}`);
    rows.push(`        EFTER: ${t ?? "(ingen text)"}`);
  };

  show("label", "Rubrik");
  show("description", "Under rubriken, nar kategorin ANVANDS");
  show("notice", "Under rubriken, nar sajten INTE anvander den");
  return rows;
}

const run = async () => {
  const site = arg("site");
  const live = hasFlag("run") || hasFlag("kor");
  const status = hasFlag("status");

  const allSites = await db.query.websites.findMany({
    columns: { id: true, name: true, domain: true, texts: true },
  });

  if (status) {
    console.log("\nEgna texter per sajt (databasen):\n");
    for (const s of allSites) {
      const short = toShortName(s.domain);
      const count = countFields(s.texts);
      const file = join("texts", `${short}.json`);
      console.log(
        `  ${short.padEnd(14)} ${String(count).padStart(2)} falt   ` +
          `${existsSync(file) ? file : "(ingen fil)"}`,
      );
    }
    console.log("\n  0 falt = sajten kor bannerns egna texter. Det ar inget fel.\n");
    process.exit(0);
  }

  if (!site) {
    console.error(
      "Anvandning:\n" +
        "  npm run publish-texts -- --site=<kortnamn>          (torrkorning)\n" +
        "  npm run publish-texts -- --site=<kortnamn> --run    (skarpt)\n" +
        "  npm run publish-texts -- --status",
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

  const path = join("texts", `${site}.json`);
  if (!existsSync(path)) {
    console.error(
      `Filen ${path} finns inte.\n\n` +
        `Skapa den med bara det sajten ska ha annorlunda:\n\n` +
        `  {\n` +
        `    "sv": {\n` +
        `      "marketing": { "notice": "Vi annonserar inte." }\n` +
        `    }\n` +
        `  }\n\n` +
        `Ska sajten kora bannerns egna texter behovs ingen fil alls.`,
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(
      `${path} ar inte giltig JSON.\n\n` +
        `  ${(error as Error).message}\n\n` +
        `Vanligast: ett kommatecken for mycket efter sista raden i ett block,\n` +
        `eller en kommentar - JSON tillater inga kommentarer.`,
    );
    process.exit(1);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(`${path} maste innehalla ett objekt, nycklat pa sprak.`);
    process.exit(1);
  }

  //----------------------------------------------------------------
  // GRANSKNINGEN. Vagrar med forklaring, hoppar aldrig over tyst.
  //----------------------------------------------------------------
  const texts: Texts = {};
  const issues: string[] = [];

  for (const [lang, categories] of Object.entries(parsed as Texts)) {
    if (!LANGUAGES.has(lang)) {
      issues.push(
        `  "${lang}": okant sprak.\n` +
          `      Bannern har texter for ${[...LANGUAGES].join(" och ")}. Ett sprak vi inte kan\n` +
          `      rita en komplett banner pa ska inte ga att fylla i halvvags.`,
      );
      continue;
    }
    if (!categories || typeof categories !== "object" || Array.isArray(categories)) {
      issues.push(`  "${lang}": maste innehalla ett objekt, nycklat pa kategori.`);
      continue;
    }

    const perCategory: Record<string, Record<string, string>> = {};

    for (const [category, fields] of Object.entries(categories)) {
      if (!(CATEGORIES as readonly string[]).includes(category)) {
        issues.push(
          `  ${lang}.${category}: okand kategori.\n` +
            `      Giltiga: ${CATEGORIES.join(", ")}.`,
        );
        continue;
      }
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        issues.push(`  ${lang}.${category}: maste innehalla ett objekt.`);
        continue;
      }

      const perField: Record<string, string> = {};

      for (const [field, value] of Object.entries(fields)) {
        if (!FIELDS.has(field)) {
          issues.push(
            `  ${lang}.${category}.${field}: okant falt.\n` +
              `      Giltiga: label (rubriken), description (nar kategorin anvands),\n` +
              `      notice (nar sajten inte anvander den).`,
          );
          continue;
        }
        if (category === "necessary" && field === "notice") {
          issues.push(
            `  ${lang}.necessary.notice: nodvandiga kan aldrig fa ett besked.\n` +
              `      Bannern satter sin egen samtyckescookie, sa ett pastaende om att\n` +
              `      sajten inte anvander nodvandiga cookies vore osant pa varje sajt.\n` +
              `      Samma sparr finns i API:t och i bannern.`,
          );
          continue;
        }
        if (typeof value !== "string" || value.trim().length === 0) {
          issues.push(
            `  ${lang}.${category}.${field}: tom text.\n` +
              `      Ett tomt varde hade sett ut som en andring men gett bannerns egen\n` +
              `      text. Ta bort raden i stallet, sa blir det tydligt.`,
          );
          continue;
        }
        if (value.length > MAX_TEXT_LENGTH) {
          issues.push(
            `  ${lang}.${category}.${field}: ${value.length} tecken, hogst ${MAX_TEXT_LENGTH}.`,
          );
          continue;
        }
        if (UNSAFE_TEXT.test(value)) {
          issues.push(
            `  ${lang}.${category}.${field}: innehaller < eller >.\n` +
              `      Texterna skrivs ut som TEXT, aldrig som HTML - taggarna hade synts\n` +
              `      for besokaren i stallet for att tolkas. Det ar med flit: det ar\n` +
              `      skalet till att texter fran databasen inte oppnar nagot XSS-hal.`,
          );
          continue;
        }
        if (BANNER_DEFAULTS[lang]?.[category]?.[field] === value) {
          issues.push(
            `  ${lang}.${category}.${field}: identisk med bannerns standardtext.\n` +
              `      Ta bort raden. Star den kvar lases sajten fast vid dagens\n` +
              `      formulering, och en framtida forbattring av standardtexten nar\n` +
              `      aldrig fram hit. Samma falla som att skriva in en designvariabel\n` +
              `      som redan ar lika med standarden.`,
          );
          continue;
        }
        perField[field] = value;
      }

      if (Object.keys(perField).length > 0) perCategory[category] = perField;
    }

    if (Object.keys(perCategory).length > 0) texts[lang] = perCategory;
  }

  //----------------------------------------------------------------
  // SKILLNADEN, ritad som kortet kommer se ut
  //----------------------------------------------------------------
  const current = (website.texts ?? {}) as Texts;
  const langs = new Set([...Object.keys(current), ...Object.keys(texts)]);
  const changes: string[] = [];

  for (const lang of [...langs].sort()) {
    for (const category of CATEGORIES) {
      const before = current[lang]?.[category] ?? {};
      const after = texts[lang]?.[category] ?? {};
      const rows = renderCard(lang, category, before, after);
      if (!rows.length) continue;
      const heading = after["label"] ?? before["label"] ?? BANNER_DEFAULTS[lang]?.[category]?.["label"] ?? category;
      changes.push(`  [${lang}] ${heading}`);
      changes.push(...rows);
    }
  }

  console.log(`\n${website.domain}   ${path}\n`);

  if (issues.length) {
    console.log("AVVISADES:\n\n" + issues.join("\n\n") + "\n");
  }

  if (!changes.length) {
    console.log("Ingen skillnad mot databasen. Ingenting att gora.\n");
    process.exit(0);
  }

  console.log("SA HAR KOMMER KORTEN SE UT:\n\n" + changes.join("\n") + "\n");

  if (!live) {
    console.log(
      "Torrkorning - ingenting skrivet. Lagg till --run nar du sett att det stammer.\n",
    );
    process.exit(0);
  }

  await db.update(websites).set({ texts }).where(eq(websites.id, website.id));

  console.log(
    "Skrivet till databasen.\n\n" +
      "SA HAR SER DU DET:\n" +
      `  Direkt, for dig    https://${website.domain}/?seos_farsk=1\n` +
      "  Direkt, for ALLA   Redeploya API:t i Vercel (Deployments -> senaste\n" +
      "                     -> Redeploy).\n" +
      "  Av sig sjalvt      Inom sex timmar. Gor ingenting.\n\n" +
      "Texterna syns i installningsrutan - oppna bannern och klicka Anpassa.\n" +
      "Verifiera pa den RIKTIGA sajten: npm run forhandsgranska i bannerrepot.\n",
  );
  process.exit(0);
};

// Kor bara nar filen startas direkt, sa att countFields() gar att importera i
// ett test utan att en databasanslutning oppnas.
if (require.main === module) {
  run().catch((error) => {
    console.error("Publiceringen misslyckades:", error);
    process.exit(1);
  });
}
