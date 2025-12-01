import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { consentRoute } from "./routes/consent";
import { cors } from "hono/cors";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "http://127.0.0.1:5500",
    allowHeaders: ["Content-Type"],
    allowMethods: ["POST"],
  })
);

app.get("/", (c) => c.json({ message: "Backend is working" }));

app.route("/consent", consentRoute);

serve({
  fetch: app.fetch,
  port: 3000,
});

console.log("Server is running on localhost: http://localhost:3000");
