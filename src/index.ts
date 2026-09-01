import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { consentRoute } from "./routes/consent";
import { configRoute } from "./routes/config";
import { cronRoute } from "./routes/cron";
import { backupRoute } from "./routes/backup";
import { cors } from "hono/cors";
import { handle } from "hono/vercel";
import { db } from "./db/client";
import { normalizeOrigin } from "./lib/origin";

const app = new Hono();

//========================================================================
// CORS - vilka adresser som far anropa API:t
//========================================================================

// Tillatna origins lases fran databasen (websites.allowed_origins) sa att en
// ny kund blir en RAD i stallet for en redigerad miljovariabel plus redeploy.
// Vid 30 sajter ar det skillnaden mellan ett SQL-kommando och 30 deployer.
//
// Miljovariabeln finns kvar som KOMPLEMENT, inte ersattning. Den haller
// adresser som inte tillhor nagon enskild kund: utvecklingsmiljoer, CDN:et,
// eventuell staging. Listorna slas ihop.
//
// Det gor ocksa overgangen ofarlig: sa lange databaskolumnerna ar tomma beter
// sig API:t exakt som forut, och sajterna kan fyllas i en i taget.

const ENV_ORIGINS = (
  process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "https://seosdesign.webflow.io",
        "https://www.seosdesign.se",
        "https://seosdesign.se",
      ]
).map(normalizeOrigin);

const CACHE_MS = 5 * 60 * 1000;
let cache: { origins: Set<string>; utgar: number } | null = null;

// En cache i minnet ar rimlig HAR, till skillnad fran rate-limitern som togs
// bort av precis den anledningen. Skillnaden: en kall cache pa en ny
// funktionsinstans kostar bara en extra databasfraga - den gor inte
// funktionen verkningslos, sa som en nollstalld raknare gjorde.
async function allowedOrigins(): Promise<Set<string>> {
  const nu = Date.now();
  if (cache && cache.utgar > nu) return cache.origins;

  try {
    const rows = await db.query.websites.findMany({
      columns: { allowed_origins: true },
    });

    const all = new Set(ENV_ORIGINS);
    for (const row of rows) {
      for (const origin of row.allowed_origins ?? []) all.add(normalizeOrigin(origin));
    }

    cache = { origins: all, utgar: nu + CACHE_MS };
    return all;
  } catch {
    // Nar databasen inte gar att na: behall senast kanda lista hellre an att
    // sla igen for samtliga kunder. Finns ingen cache an, fall tillbaka pa
    // miljovariabeln sa att atminstone de kanda adresserna slapps igenom.
    console.error("[CORS] Kunde inte hamta tillatna origins fran databasen");
    return cache?.origins ?? new Set(ENV_ORIGINS);
  }
}

// /config ar UNDANTAGET fran origin-lasningen, med flit. Tva skal:
//
// 1. CACHNINGEN. Svaret fran /config cachas pa CDN:et - det ar det som haller
//    databaslasten platt nar antalet sidvisningar vaxer. Ett CORS-svar beror
//    pa vilken Origin som fragade, sa ett cachat svar med seosdesigns adress
//    hade serverats till brevenshus och brutit bannern dar. Ett fast "*"
//    ar samma for alla och gar darfor att cacha.
//
// 2. DET SKYDDAR INGENTING HAR. Origin-lasningen finns for att binda en site
//    key till sajtens adresser pa SKRIVvagen, sa att ingen kan forfalska
//    poster i bevisloggen. /config ar lasning av publika designvarden - farger
//    och typsnitt som redan syns pa kundens sajt. CORS hindrar dessutom bara
//    webblasare; vem som helst kan hamta adressen med curl anda.
const oppenKors = cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] });

const lastKors = cors({
  origin: async (origin) => {
    if (!origin) return undefined;
    const allowed = await allowedOrigins();
    // Svaret maste eka exakt den adress webblasaren skickade, inte den
    // normaliserade varianten.
    return allowed.has(normalizeOrigin(origin)) ? origin : undefined;
  },
  allowHeaders: ["Content-Type"],
  allowMethods: ["POST", "GET", "OPTIONS"],
});

app.use("*", async (c, next) =>
  c.req.path.startsWith("/config") ? oppenKors(c, next) : lastKors(c, next),
);

// Rate limiting sker i Vercels brandvagg (Firewall -> Custom Rules), inte har.
//
// Har lag tidigare en rateLimiter() fran hono-rate-limiter utan konfigurerad
// store, vilket innebar att den anvande en raknare i minnet. Pa serverless har
// varje funktionsinstans sitt eget minne, och Vercel startar nya instanser under
// last - raknaren nollstalldes darfor hela tiden och delades aldrig mellan
// instanser. Skyddet fanns i praktiken bara pa pappret.
//
// Den ar borttagen i stallet for ersatt, eftersom kod som ser ut att skydda men
// inte gor det ar samre an ingen kod alls.

app.get("/", (c) => c.json({ message: "Backend is working" }));

app.route("/consent", consentRoute);
app.route("/config", configRoute);
app.route("/cron", cronRoute);
app.route("/cron", backupRoute);

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);

// Exporteras for att kunna anropas direkt i tester, utan att starta en server:
// app.request("/consent", { method: "OPTIONS", headers: { Origin: "..." } }).
// Vercel routar pa metodexporterna ovan och bryr sig inte om den har.
export { app };
