import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { websites } from "../db/schema";

//========================================================================
// GET /config/:siteKey - sajtens designvarden (C1 steg 1)
//========================================================================
//
// Bannern hamtar harifran i stallet for att lasa CSS-variabler ur ett
// designblock i kundens <head>. Det gor en omdesign till ett databasvarde:
// ingen kod, ingen deploy, ingen atkomst till kundens sajt.
//
// DEN HAR ROUTEN AR SPECIELL: den anropas en gang per SIDVISNING, medan
// /consent anropas en gang per BESOKARE. Det ar den enda hogfrekventa
// trafiken i systemet. Darfor cachas svaret pa Vercels CDN - utan det vaxer
// databaslasten linjart med trafiken hos samtliga kunder.

export const configRoute = new Hono();

// Hur lange CDN:et far aterananvanda svaret.
//
// EN TIMME, och siffran ar rakt fram beraknad - inte gissad. Neon pa
// gratisplanen sover nar ingen fragar och betalas i CU-timmar, alltsa i TID
// DA DATABASEN AR VAKEN. Varje uppvakning haller den igang minst fem minuter.
//
// Med fem minuters cache (forsta forsoket) hade CDN:et fragat tolv ganger i
// timmen och per sajt, vilket i praktiken hade hallit databasen vaken hela
// den tid sajterna har trafik. Uppmatt utgangslage 2026-08-21: ~0,93
// CU-timmar per dygn, nastan allt orsakat av var egen timvisa overvakning.
// Fem minuters cache hade lagt C1 ovanpa det och tagit forbrukningen mot
// taket pa 100 CU-timmar i manaden - innan fjarde kunden ens fanns.
//
// Med en timme blir C1 billigare an uptime-kontrollen redan ar.
//
// Priset: en designandring nar besokarna efter upp till en timme. For farger
// ar det rimligt. Behovs det snabbare finns tva vagar: kortare varde har, i
// utbyte mot berakningstid, eller att cachen rensas vid skrivning (naturlig
// del av D4, admin-granssnittet).
const CDN_CACHE_SEKUNDER = 60 * 60;
// Under revalidering far CDN:et servera det gamla svaret. Ett dygn: hellre
// gammal design an ingen design, och en langsam databas ska aldrig bli en
// langsam banner for besokaren.
const STALE_SEKUNDER = 24 * 60 * 60;

// Cache i funktionens minne, ovanpa CDN-cachen. Samma monster och samma
// motivering som origin-listan i index.ts: pa serverless ar en kall cache
// ofarlig - den kostar en extra fraga, den gor inte funktionen verkningslos
// (till skillnad fran den nollstallda rate-limit-raknare som togs bort).
//
// Fangar det som anda tar sig forbi CDN:et: revalideringar, flera
// CDN-noder, och kalla starter tatt inpa varandra.
const MINNE_MS = 5 * 60 * 1000;
const minne = new Map<string, { design: Record<string, string>; utgar: number }>();

// Site keys ser ut som pk_live_<32 hex>. Grans mot orimliga varden innan
// nagon databasfraga stalls.
const MAX_NYCKELLANGD = 100;
const MAX_VARDELANGD = 200;

// VILKA VARIABLER SOM FAR SATTAS FRAN DATABASEN
//
// Designmodellen, bestamd 2026-08-20: GEOMETRI lika pa alla sajter,
// VARUMARKE per sajt. Bannern ska kannas som samma komponent overallt men
// bara kundens uttryck.
//
// Darfor star INTE dessa med, med flit: --banner-width, alla --*-text-size,
// --icon-container-size, alla --space-*, --btn-line-height,
// --header-line-height. Ser storleken fel ut ska BASVARDET rattas i
// banner-src/style.css - da nar andringen alla sajter. Satts vardet per kund
// nar framtida basandringar aldrig fram dit det ar overstyrt.
//
// --icon-path star heller inte med: den innehaller en url(), alltso ett varde
// som far webblasaren att hamta nagot. Vill vi gora ikonen konfigurerbar ska
// adressen valideras for sig.
const TILLATNA_VARIABLER = new Set([
  // Farger
  "bg-main",
  "bg-muted",
  "text-main",
  "text-muted",
  "accent-color",
  "accent-hover",
  "bg-dark-btn",
  "border-color",
  "btn-border",
  "logo-color",
  "bg-logo-wrapper",
  "bg-customize-btn",
  "toggle-switch-bg",
  "toggle-circle",
  // Knapptext och hovring
  "btn-accent-text",
  "btn-hover-filter",
  "btn-secondary-hover-bg",
  "btn-secondary-hover-filter",
  // Tillganglighet - egna variabler sa en sajt kan gora dem synliga mot sin
  // egen bakgrund. En fokusring som inte syns ar samma sak som ingen ring.
  "fokus-ring",
  "scrollbar-thumb",
  "policy-link-color",
  "badge-text-color",
  // Ovrigt utseende
  "scroll-gradient",
  // Typsnitt. Bannern laddar aldrig egna - den anvander de sajten redan har.
  "main-font",
  "header-font",
  // Radier
  "radius-sm",
  "radius-md",
  "radius-lg",
]);

// Vardet skrivs med style.setProperty(), alltsa in i CSS-motorn som ett
// VARDE - det tolkas aldrig som HTML eller JavaScript. Det ar skalet till att
// steg 1 saknar den XSS-yta som steg 3 (texter) har.
//
// Kvar finns anda en sak vard att stanga: ett CSS-varde kan innehalla url(),
// och da hamtar webblasaren nagot fran en adress vi inte valt. Det ar en
// tankbar vag att spara besokare eller lacka data.
//
// Angriparen har skulle behova skrivratt i var databas, alltsa vara oss.
// Kontrollen ar darfor djupforsvar, inte huvudskydd - men den ar billig, och
// den ar det som gor ett framtida admin-granssnitt (D4) ofarligt att bygga.
const FARLIGT = /url\(|expression\(|javascript:|@import|[<>{}\\;]/i;

function giltigtVarde(varde: unknown): varde is string {
  return (
    typeof varde === "string" &&
    varde.length > 0 &&
    varde.length <= MAX_VARDELANGD &&
    !FARLIGT.test(varde)
  );
}

/** Slapper bara igenom kanda variabler med rimliga varden. */
export function rensaDesign(design: unknown): Record<string, string> {
  if (!design || typeof design !== "object" || Array.isArray(design)) return {};

  const rensad: Record<string, string> = {};
  for (const [nyckel, varde] of Object.entries(design as Record<string, unknown>)) {
    if (!TILLATNA_VARIABLER.has(nyckel)) continue;
    if (!giltigtVarde(varde)) continue;
    rensad[nyckel] = varde;
  }
  return rensad;
}

configRoute.get("/:siteKey", async (c) => {
  const siteKey = c.req.param("siteKey");

  if (!siteKey || siteKey.length > MAX_NYCKELLANGD) {
    return c.json({ message: "Invalid site key." }, 400);
  }

  // Cachas pa CDN:et, INTE i besokarens webblasare (max-age=0). Da nar en
  // rattelse alla besokare vid nasta sidladdning sa fort CDN:et uppdaterats,
  // i stallet for att ligga kvar i enskilda webblasare i en timme till.
  const settCacheHuvud = () =>
    c.header(
      "Cache-Control",
      c.req.query("farsk") !== undefined
        ? "no-store"
        : `public, max-age=0, s-maxage=${CDN_CACHE_SEKUNDER}, stale-while-revalidate=${STALE_SEKUNDER}`,
    );

  // FARSKLAGE. Bannern lagger till ?farsk=<tidsstampel> nar nagon oppnat
  // sidan med ?seos_farsk=1 - alltsa nar en manniska sitter och justerar
  // farger och vill se resultatet nu, inte om en timme.
  //
  // Da hoppas BADA cacherna over. Tidsstampeln gor adressen unik sa CDN:et
  // inte kan svara ur sin cache, och no-store hindrar att svaret sparas.
  //
  // Kostar ingenting i drift: bara den som sjalv ber om det gar forbi, och
  // det ar en manniska at gangen. Ingen ny angreppsyta heller -
  // policy-endpointen ar redan ocachad och traffar databasen likadant.
  const farsk = c.req.query("farsk") !== undefined;

  if (!farsk) {
    const cachat = minne.get(siteKey);
    if (cachat && cachat.utgar > Date.now()) {
      settCacheHuvud();
      return c.json({ design: cachat.design });
    }
  }

  try {
    const website = await db.query.websites.findFirst({
      where: eq(websites.site_key, siteKey),
      columns: { design: true },
    });

    if (!website) {
      // Ingen cachning pa fel nyckel - varken har eller i minnet. Rattas
      // nyckeln ska det sla igenom direkt.
      return c.json({ message: "Invalid site key." }, 404);
    }

    const design = rensaDesign(website.design);
    // I farsklage skrivs inte minnescachen heller - annars hade nasta vanliga
    // anrop serverats ur ett resultat som hamtades for att kringga cachen.
    if (!farsk) minne.set(siteKey, { design, utgar: Date.now() + MINNE_MS });

    settCacheHuvud();
    return c.json({ design });
  } catch (fel) {
    console.error("[config] Kunde inte hamta design:", fel);
    // Bannern faller tillbaka pa sina standardvarden vid fel. Ingen cachning -
    // ett tillfalligt databasfel ska inte ligga kvar i fem minuter.
    return c.json({ message: "Could not load configuration." }, 500);
  }
});
