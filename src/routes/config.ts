import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { websites } from "../db/schema";

//========================================================================
// GET /config/:siteKey - sajtens design och kategorier (C1 steg 1-2)
//========================================================================
//
// Bannern hamtar harifran i stallet for att lasa CSS-variabler ur ett
// designblock i kundens <head>. Det gor en omdesign till ett databasvarde:
// ingen kod, ingen deploy, ingen atkomst till kundens sajt.
//
// Sedan steg 2 foljer ocksa KATEGORIERNA med - alltsa vilka kort som visas i
// installningsrutan. En sajt utan funktionella cookies ska inte visa ett
// reglage for dem (C10). Kategorierna aker med i samma svar med flit: det ar
// samma cache, samma anrop och samma villkor, sa steget kostar ingen ny
// trafik och paverkar inte CU-timmarna.
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
// ---------------------------------------------------------------------------
// RATTELSE 2026-08-28: en timme rackte inte. Hojd till SEX.
// ---------------------------------------------------------------------------
//
// Utrakningen ovan holl inte, men felet lag inte i cachen - den fungerar.
// Uppmatt: forbrukningen gick fran 0,81 till 5,91 CU-timmar per dygn de tre
// dygnen efter att C1 steg 1 gick i drift. Taket ar 100 i manaden, sa i den
// takten hade september slagit i det.
//
// Vad matningen visade:
//   - CDN:et haller svaret hela timmen ut. Age klattrade 349 -> 1505 sekunder
//     over 20 minuter utan en enda ny hamtning. Cachen ar alltsa inte trasig.
//   - Databasen vaknade anda ungefar var trettonde minut.
//
// Forklaringen: Neon stannar vaken MINST FEM MINUTER per uppvakning, oavsett
// om den far en fraga eller tusen. Kostnaden styrs alltsa av hur OFTA den
// vacks, inte av hur mycket den gor. Och det som vacker den ar att cachen gar
// ut - separat pa varje plats i CDN:et. Med en handfull aktiva platser blir
// det ett uppvaknande var trettonde minut, precis som uppmatt.
//
// Darfor sitter spaken har: sex timmar i stallet for en ger en sjattedel sa
// manga uppvakningar. Beraknad landning ~50 CU-timmar i manaden - berakningen
// ska stammas av mot verkligt utfall innan den tros pa.
//
// Priset: en designandring nar besokarna efter upp till sex timmar i stallet
// for en. Tva nodutgangar finns, och ingen kostar nagot:
//   - ?seos_farsk=1 gar forbi bada cacherna for den som kontrollerar
//   - en redeploy av API:t tomer CDN-cachen direkt for alla besokare
// Den andra skrivs ut av publish-design och star i driftmanualen avsnitt 13.
//
// Besokaren vantar aldrig langre an idag: stale-while-revalidate nedan gor att
// CDN:et serverar det gamla svaret direkt och hamtar nytt i bakgrunden.
const CDN_CACHE_SECONDS = 60 * 60 * 6;
// Under revalidering far CDN:et servera det gamla svaret. Ett dygn: hellre
// gammal design an ingen design, och en langsam databas ska aldrig bli en
// langsam banner for besokaren.
const STALE_SECONDS = 24 * 60 * 60;

// Cache i funktionens minne, ovanpa CDN-cachen. Samma monster och samma
// motivering som origin-listan i index.ts: pa serverless ar en kall cache
// ofarlig - den kostar en extra fraga, den gor inte funktionen verkningslos
// (till skillnad fran den nollstallda rate-limit-raknare som togs bort).
//
// Fangar det som anda tar sig forbi CDN:et: revalideringar, flera
// CDN-noder, och kalla starter tatt inpa varandra.
const MEMORY_TTL_MS = 5 * 60 * 1000;

type Category = {
  key: string;
  is_required: boolean;
  // "toggle" = kort med reglage. "notice" = kort med besked om att sajten
  // inte anvander kategorin. Kortet visas i BADA fallen - kategorinamnet
  // forsvinner aldrig.
  visibility: "toggle" | "notice";
};

const minne = new Map<
  string,
  { design: Record<string, string>; kategorier: Category[]; utgar: number }
>();

// Site keys ser ut som pk_live_<32 hex>. Grans mot orimliga varden innan
// nagon databasfraga stalls.
const MAX_KEY_LENGTH = 100;
const MAX_VALUE_LENGTH = 200;

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
const ALLOWED_VARIABLES = new Set([
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
const UNSAFE_VALUE = /url\(|expression\(|javascript:|@import|[<>{}\\;]/i;

function isValidValue(varde: unknown): varde is string {
  return (
    typeof varde === "string" &&
    varde.length > 0 &&
    varde.length <= MAX_VALUE_LENGTH &&
    !UNSAFE_VALUE.test(varde)
  );
}

/** Slapper bara igenom kanda variabler med rimliga varden. */
export function sanitizeDesign(design: unknown): Record<string, string> {
  if (!design || typeof design !== "object" || Array.isArray(design)) return {};

  const rensad: Record<string, string> = {};
  for (const [nyckel, varde] of Object.entries(design as Record<string, unknown>)) {
    if (!ALLOWED_VARIABLES.has(nyckel)) continue;
    if (!isValidValue(varde)) continue;
    rensad[nyckel] = varde;
  }
  return rensad;
}

// VILKA KATEGORIER SOM GAR ATT VISA - och i vilken ordning
//
// Listan ar bade en TILLATLISTA och en SORTERING. Tabellen har ingen
// sorteringskolumn, sa ordningen maste komma harifran.
//
// Att den ar en tillatlista ar det viktiga: bannerns etiketter ("Analys och
// prestanda", "Marknadsforing") ligger i dess EGEN sprakabell, inte i
// databasen. En kategori vi inte har text for gar darfor inte att rita, och
// ska heller inte skickas.
//
// Foljden ar vard att sagas rakt ut: STEG 2 KAN TA BORT KATEGORIER, INTE
// LAGGA TILL NYA. En femte kategori kraver texter fran databasen, alltsa
// steg 3. Det ar en avgransning, inte en brist - C10 handlar om att sluta
// visa kort som inte betyder nagot.
//
// BESKEDSLAGET (2026-08-31): en kategori som sajten inte anvander DOLJS INTE.
// Den visas som ett kort utan reglage, med texten "Den har webbplatsen
// anvander inga marknadsforingscookies".
//
// Bjorns beslut, och det ar battre an att dolja: en avstangd knapp som inte
// styr nagot gor rutan mindre trovardig, men ett besked om att vi INTE sparar
// for annonser ar en utsaga i stallet for en fraga. Det bygger fortroende i
// stallet for att bara ta bort brus.
//
// ⚠️ Priset ar att ett fel blir ett FALSKT PASTAENDE till besokaren, inte bara
// en dod knapp. Anvands beskedslaget hos en extern kund maste C12:s larm finnas
// - annars kan bannern pasta att sajten inte anvander marknadsforingscookies
// dagen efter att nagon lagt in en pixel.
//
// Listan ar med flit en KOPIA av bannerns egen, precis som med
// designvariablerna. Driver de isar galler snittet: en kategori slutar visas,
// i stallet for att en okand kategori borjar ritas. Fel at ratt hall.
const CATEGORY_ORDER = [
  "necessary",
  "analytics",
  "functional",
  "marketing",
] as const;

/**
 * Slapper bara igenom kanda kategorier - i fast ordning, med hur var och en
 * ska visas.
 *
 *   visibility: "toggle"  sajten anvander kategorin -> kort med reglage
 *   visibility: "notice"  sajten anvander den inte  -> kort med besked
 *
 * Tom lista betyder "databasen sa ingenting begripligt". Bannern faller da
 * tillbaka pa sina fyra standardkategorier, alla som reglage. En banner utan
 * kategorier vore ett mycket varre fel an en banner med for manga.
 */
export function sanitizeCategories(rader: unknown): Category[] {
  if (!Array.isArray(rader)) return [];

  const funna = new Map<string, { is_required: boolean; anvands: boolean }>();

  for (const rad of rader) {
    if (!rad || typeof rad !== "object") continue;
    const { key, is_required, is_active } = rad as Record<string, unknown>;
    if (typeof key !== "string") continue;
    if (!(CATEGORY_ORDER as readonly string[]).includes(key)) continue;
    // Bara ett uttryckligt false ger besked. Saknas kolumnen visas reglaget -
    // det sakra fallet ar att FRAGA, inte att pasta nagot om sajten.
    funna.set(key, {
      is_required: is_required === true,
      anvands: is_active !== false,
    });
  }

  if (funna.size === 0) return [];

  // NODVANDIGA AR ALLTID MED, ALLTID OBLIGATORISKA OCH ALLTID ETT REGLAGE.
  //
  // Bannern satter sin egen samtyckescookie, sa kategorin ar sann pa varje
  // sajt - det finns inget lage dar ett besked om motsatsen vore sant. Och
  // payloaden skickar alltid necessary: true, sa ett reglage som gick att
  // stanga av hade ljugit for besokaren om vad som faktiskt hander.
  //
  // Invarianten ligger har och inte i ett databasvillkor av samma skal som
  // geometrin avvisas i publish-design: felet ska fangas med en forklaring,
  // inte tyst falla bort langre fram.
  funna.set("necessary", { is_required: true, anvands: true });

  return CATEGORY_ORDER.filter((key) => funna.has(key)).map((key) => {
    const rad = funna.get(key)!;
    return {
      key,
      is_required: rad.is_required,
      visibility: rad.anvands ? ("toggle" as const) : ("notice" as const),
    };
  });
}

configRoute.get("/:siteKey", async (c) => {
  const siteKey = c.req.param("siteKey");

  if (!siteKey || siteKey.length > MAX_KEY_LENGTH) {
    return c.json({ message: "Invalid site key." }, 400);
  }

  // Cachas pa CDN:et, INTE i besokarens webblasare (max-age=0). Da nar en
  // rattelse alla besokare vid nasta sidladdning sa fort CDN:et uppdaterats,
  // i stallet for att ligga kvar i enskilda webblasare i en timme till.
  const setCacheHeaders = () =>
    c.header(
      "Cache-Control",
      c.req.query("farsk") !== undefined
        ? "no-store"
        : `public, max-age=0, s-maxage=${CDN_CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
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
      setCacheHeaders();
      return c.json({ design: cachat.design, categories: cachat.kategorier });
    }
  }

  try {
    // Design och kategorier hamtas i EN fraga, inte tva. Varje anrop som nar
    // fram till databasen haller Neon vaken i minst fem minuter, sa antalet
    // fragor spelar mindre roll an antalet uppvakningar - men tva rundturer
    // dar en racker ar anda dubbelt sa manga tillfallen att vanta pa natet.
    const website = await db.query.websites.findFirst({
      where: eq(websites.site_key, siteKey),
      columns: { design: true },
      with: {
        categories: {
          // description hamtas INTE. Det ar text, och text fran databasen ut
          // pa kundsajter ar C1 steg 3 - den som bar XSS-ytan. Stegen ska
          // halla isar, aven nar kolumnen ligger en armlangd bort.
          columns: { key: true, is_required: true, is_active: true },
        },
      },
    });

    if (!website) {
      // Ingen cachning pa fel nyckel - varken har eller i minnet. Rattas
      // nyckeln ska det sla igenom direkt.
      return c.json({ message: "Invalid site key." }, 404);
    }

    const design = sanitizeDesign(website.design);
    const kategorier = sanitizeCategories(website.categories);
    // I farsklage skrivs inte minnescachen heller - annars hade nasta vanliga
    // anrop serverats ur ett resultat som hamtades for att kringga cachen.
    if (!farsk) {
      minne.set(siteKey, { design, kategorier, utgar: Date.now() + MEMORY_TTL_MS });
    }

    setCacheHeaders();
    return c.json({ design, categories: kategorier });
  } catch (fel) {
    console.error("[config] Kunde inte hamta design:", fel);
    // Bannern faller tillbaka pa sina standardvarden vid fel. Ingen cachning -
    // ett tillfalligt databasfel ska inte ligga kvar i fem minuter.
    return c.json({ message: "Could not load configuration." }, 500);
  }
});
