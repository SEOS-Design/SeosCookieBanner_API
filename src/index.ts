import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { consentRoute } from "./routes/consent";
// import { consentRoute } from "./routes/consent";

const app = new Hono();

app.get("/", (c) => c.json({ message: "Backend is working" }));

app.route("/consent", consentRoute);

serve({
  fetch: app.fetch,
  port: 3000,
});

console.log("Server is running on localhost: http://localhost:3000");
