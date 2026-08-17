import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { consentRoute } from "./routes/consent";
import { cors } from "hono/cors";
import { handle } from "hono/vercel";

const app = new Hono();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "https://seosdesign.webflow.io",
      "https://www.seosdesign.se",
      "https://seosdesign.se",
    ];

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowHeaders: ["Content-Type"],
    allowMethods: ["POST", "GET", "OPTIONS"],
  }),
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

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
