import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { loadEnv } from "./env.js";
import { buildServices } from "./services.js";
import { setLocalJobHandler } from "./jobs.js";
import { buildJobHandler } from "./job-handlers.js";
import { twilioRoutes } from "./routes/twilio.js";
import { leadRoutes } from "./routes/leads.js";
import { adminRoutes } from "./routes/admin.js";
import { oauthRoutes } from "./routes/oauth.js";

const env = loadEnv();
const svc = buildServices(env);

if (!env.REDIS_URL) setLocalJobHandler(buildJobHandler(svc));

const app = Fastify({ logger: env.NODE_ENV !== "test" });
const origins = env.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
await app.register(cors, { origin: origins, credentials: true });
await app.register(formbody);

app.get("/health", async () => ({ ok: true, model: env.AGENT_MODEL, jobs: env.REDIS_URL ? "bullmq" : "in-process" }));

await app.register(twilioRoutes, { svc });
await app.register(leadRoutes, { svc });
await app.register(adminRoutes, { svc });
await app.register(oauthRoutes, { svc });

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
