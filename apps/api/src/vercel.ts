/**
 * Vercel entry: every route is rewritten here (see vercel.json). Fastify handles the request;
 * background work (the Claude turn after the Twilio ACK, lead scoring) is kept alive with waitUntil.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import { loadEnv } from "./env.js";
import { buildServices } from "./services.js";
import { buildApp } from "./app.js";

const appPromise = buildApp(buildServices(loadEnv(), { defer: (work) => waitUntil(work) }));

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await appPromise;
  await app.ready();
  app.server.emit("request", req, res);
}
