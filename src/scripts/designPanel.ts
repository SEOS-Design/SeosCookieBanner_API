/**
 * DESIGNPANELEN (2b) — designa bannern mot kundens riktiga sajt.
 *
 *   npm run design -- --site=tillvaxthuset
 *   npm run design -- --site=tillvaxthuset --url=https://www.tillvaxthuset.se/kontakt
 *
 * Oppnar ett riktigt webblasarfonster med kundens sajt och en panel i hornet.
 * Andringarna syns direkt, i sajtens egna typsnitt och innehall.
 *
 *
 * SA FUNGERAR DET
 *
 * Bannern fragar API:t efter sajtens design. Panelen fangar det anropet och
 * svarar med vardena fran `design/<kund>.css` PA DIN DATOR i stallet. Kundens
 * sajt marker ingenting, och ingenting skrivs nagonstans forran du klickar.
 *
 * Bannerfilen hamtas daremot fran CDN:et - alltsa exakt den kod kunderna kor.
 * Ska ny bannerKOD provas ar det `npm run forhandsgranska` i bannerrepot som
 * galler, inte det har verktyget.
 *
 *
 * ⚠️ INGA ROBOTSAMTYCKEN. Klickar du Acceptera for att se knapparnas hovring
 * avbryts skrivningen till bevisloggen, precis som i skannern och
 * forhandsgranskaren. Kundens bevis ska bara innehalla riktiga besokare.
 */

import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { chromium } from "playwright";
import { db } from "../db/client";
import { websites } from "../db/schema";
import { DESIGN_GROUPS } from "../lib/designVariables";
import {
  parseVariables,
  toDesignCss,
  contrastRatio,
  CONTRAST_MINIMUM,
} from "../lib/designFile";
import { buildPanel } from "./designPanelUi";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const toShortName = (domain: string): string => domain.replace(/^www\./, "").split(".")[0]!;

/** Kategorierna bannern kan rita, i den ordning API:t serverar dem. */
const CATEGORY_KEYS = ["necessary", "functional", "analytics", "marketing"] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];
type Visibility = "toggle" | "notice";

const run = async () => {
  const site = arg("site");

  const allSites = await db.query.websites.findMany({
    columns: { name: true, domain: true, design: true },
  });

  if (!site) {
    console.error(
      "Anvandning:\n" +
        "  npm run design -- --site=<kortnamn>\n" +
        "  npm run design -- --site=<kortnamn> --url=<adress pa sajten>\n\n" +
        `Tillgangliga: ${allSites.map((s) => toShortName(s.domain)).join(", ")}`,
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

  // Filen ar sanningen. Saknas den kor sajten bannerns basvarden, och da borjar
  // panelen tom - precis som en ny kund gor.
  const filePath = join("design", `${site}.css`);
  const values: Record<string, string> = existsSync(filePath)
    ? parseVariables(readFileSync(filePath, "utf8"))
    : {};

  const inDatabase = Object.keys(website.design ?? {}).length;
  if (!existsSync(filePath) && inDatabase > 0) {
    console.warn(
      `\n⚠️  ${filePath} saknas, men databasen har ${inDatabase} varden for sajten.\n` +
        "   Panelen borjar fran bannerns basvarden. Sparar och publicerar du nu\n" +
        "   ERSATTS databasens varden. Hamta dem forst om de ska behallas:\n" +
        `   npm run publish-design -- --status\n`,
    );
  }

  // Forhandsvisning av beskedslaget. Ligger BARA i minnet har - ingenting
  // skrivs till databasen, och bytet gors fortfarande medvetet och separat
  // (beslut 2026-09-18: alternativ B).
  const visibility: Partial<Record<CategoryKey, Visibility>> = {};

  const startUrl = arg("url") ?? `https://${website.domain}/?seos_preview`;

  console.log(`\nOppnar ${startUrl}`);
  console.log(`Design: ${existsSync(filePath) ? filePath : "(ingen fil - bannerns basvarden)"}\n`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1500,1000", "--window-position=40,20"],
  });
  const context = await browser.newContext({ viewport: null });

  // 1. Designen: svara med vardena fran panelen i stallet for databasens.
  await context.route("**/config/**", async (route) => {
    const response = await route.fetch();
    let body: {
      design?: Record<string, string>;
      categories?: { key: string; visibility: Visibility }[];
      texts?: unknown;
    };
    try {
      body = await response.json();
    } catch {
      // Ett 404 eller ett felsvar slapps igenom som det ar - bannern ska bete
      // sig exakt som hos besokaren nar configen inte gar att hamta.
      return route.fulfill({ response });
    }

    body.design = { ...values };
    if (Array.isArray(body.categories)) {
      body.categories = body.categories.map((category) => {
        const override = visibility[category.key as CategoryKey];
        return override ? { ...category, visibility: override } : category;
      });
    }

    await route.fulfill({
      response,
      json: body,
      headers: { ...response.headers(), "cache-control": "no-store" },
    });
  });

  // 2. Inga robotsamtycken i kundens bevislogg.
  await context.route("**/consent", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );

  const page = await context.newPage();

  // --- Panelens knappar, korda har i Node -------------------------------
  await page.exposeFunction("seosSetVariable", (name: string, value: string) => {
    if (value === "") delete values[name];
    else values[name] = value;
  });

  await page.exposeFunction("seosContrast", (a: string, b: string) => contrastRatio(a, b));

  /**
   * Skriver panelens varden till designfilen.
   *
   * Ligger i en egen funktion for att publiceringen ska kunna anropa den
   * FORST: publish-design laser filen, aldrig panelens minne. Utan det hade
   * ett klick pa Publicera skickat ivag den GAMLA designen och anda svarat
   * "Publicerat" - ett tyst fel av precis den sort som ar svarast att hitta.
   */
  const saveToFile = (): { ok: boolean; message: string } => {
    try {
      const css = toDesignCss(values, { title: `${website.name ?? site} — ${website.domain}` });
      writeFileSync(filePath, css, "utf8");
      console.log(`Sparat ${Object.keys(values).length} varden till ${filePath}`);
      return { ok: true, message: `Sparat till ${filePath}` };
    } catch (error) {
      console.error(`Kunde inte spara: ${error}`);
      return { ok: false, message: String(error) };
    }
  };

  await page.exposeFunction("seosSave", () => saveToFile());

  await page.exposeFunction("seosPublish", () => {
    // Spara forst. Stannar allt har om filen inte gick att skriva: battre att
    // ingenting hander an att en gammal fil publiceras som om den vore ny.
    const saved = saveToFile();
    if (!saved.ok) return saved;

    // Publiceringen gors av publish-design, inte av en kopia har. Samma
    // kontroller, samma utskrift, samma rutin som i driftmanualen.
    console.log("\nPublicerar...\n");
    const result = spawnSync(
      "npm",
      ["run", "publish-design", "--", `--site=${site}`, "--run"],
      { stdio: "inherit", shell: true },
    );
    const ok = result.status === 0;
    return {
      ok,
      message: ok
        ? "Publicerat. CDN:et kan servera det gamla i upp till 6 h - se terminalen."
        : "Publiceringen misslyckades. Felet star i terminalen.",
    };
  });

  await page.exposeFunction("seosSetVisibility", (key: string, value: Visibility | "") => {
    if (value === "") delete visibility[key as CategoryKey];
    else visibility[key as CategoryKey] = value;
  });

  // Panelen ritas om vid varje sidladdning - klickar man runt pa sajten ska
  // den folja med.
  page.on("domcontentloaded", async () => {
    try {
      await page.evaluate(buildPanel, {
        groups: DESIGN_GROUPS,
        values,
        categories: CATEGORY_KEYS as unknown as string[],
        visibility,
        minimum: CONTRAST_MINIMUM,
        filePath,
      });
    } catch {
      // En navigering mitt i injektionen ar ofarlig: nasta domcontentloaded
      // ritar panelen igen.
    }
  });

  let failed = false;
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (error) {
    failed = true;
    console.error(`Kunde inte ladda sidan: ${String(error).split("\n")[0]}`);
    console.error("Fonstret ar oppet - ladda om for hand nar natet ar tillbaka.");
  }

  if (!failed) {
    console.log("Fonstret ar oppet. Stang det nar du ar klar.\n");
  }

  // Skriptet lever tills fonstret stangs.
  await page.waitForEvent("close", { timeout: 0 }).catch(() => undefined);
  await browser.close().catch(() => undefined);
  process.exit(0);
};

if (require.main === module) {
  run().catch((error) => {
    console.error("Designpanelen kraschade:", error);
    process.exit(1);
  });
}
