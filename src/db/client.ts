import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { WebSocket as WsWebSocket } from "ws";
import * as schema from "./schema";

// Neons drivrutin ansluter over WebSocket. Node har inbyggd WebSocket forst fran v22,
// sa vi satter en implementation explicit for att fungera aven pa aldre runtimes.
neonConfig.webSocketConstructor = WsWebSocket;

// TLS hanteras korrekt av drivrutinen - ingen avstangd certifikatvalidering behovs.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
