import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { consentRoute } from "./routes/consent";
import { cors } from "hono/cors";
import { rateLimiter } from "hono-rate-limiter";
import { handle } from "hono/vercel";

const app = new Hono();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "https://seosdesign.webflow.io",
    ];

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowHeaders: ["Content-Type"],
    allowMethods: ["POST", "GET", "OPTIONS"],
  }),
);

app.use(
  rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Max 100 calls per IP adress during 15 minutes
    standardHeaders: "draft-6",
    keyGenerator: (c) => {
      return c.req.header("x-forwarded-for") || "unknown";
    },
  }),
);

app.get("/", (c) => c.json({ message: "Backend is working" }));

app.route("/consent", consentRoute);

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
