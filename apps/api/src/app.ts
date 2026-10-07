import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import type { Services } from "./services.js";
import { setLocalJobHandler } from "./jobs.js";
import { buildJobHandler } from "./job-handlers.js";
import { twilioRoutes } from "./routes/twilio.js";
import { leadRoutes } from "./routes/leads.js";
import { adminRoutes } from "./routes/admin.js";
import { oauthRoutes } from "./routes/oauth.js";

/** Build the Fastify app without listening. Used by server.ts (long-lived) and api/index.ts (Vercel). */
export async function buildApp(svc: Services): Promise<FastifyInstance> {
  const { env } = svc;
  if (!env.REDIS_URL) setLocalJobHandler(buildJobHandler(svc));

  const app = Fastify({ logger: env.NODE_ENV !== "test", trustProxy: true });
  const origins = env.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(formbody);
  // Global ceiling; the public lead endpoints get a tighter per-route limit.
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  app.get("/health", async () => ({ ok: true, model: env.AGENT_MODEL, jobs: env.REDIS_URL ? "bullmq" : "in-process" }));

  await app.register(twilioRoutes, { svc });
  await app.register(leadRoutes, { svc });
  await app.register(adminRoutes, { svc });
  await app.register(oauthRoutes, { svc });
  return app;
}
