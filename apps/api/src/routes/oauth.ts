import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@bookedai/db";
import { exchangeGoogleCode, googleAuthUrl, googleOAuthConfigFromEnv } from "@bookedai/integrations";
import type { Services } from "../services.js";

/**
 * Google Calendar connect flow for a client owner.
 *   GET /oauth/google/start?clientSlug=...&token=ADMIN_TOKEN  -> redirect to Google
 *   GET /oauth/google/callback?code=...&state=<clientId>       -> store tokens
 */
export const oauthRoutes: FastifyPluginAsync<{ svc: Services }> = async (app, { svc }) => {
  app.get<{ Querystring: { clientSlug?: string; token?: string } }>("/oauth/google/start", async (req, reply) => {
    const cfg = googleOAuthConfigFromEnv();
    if (!cfg) return reply.code(500).send("Google OAuth not configured (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI)");
    if (req.query.token !== svc.env.ADMIN_TOKEN) return reply.code(401).send("Unauthorized");
    const client = req.query.clientSlug ? await prisma.client.findUnique({ where: { slug: req.query.clientSlug } }) : null;
    if (!client) return reply.code(404).send("Unknown client");
    return reply.redirect(googleAuthUrl(cfg, client.id));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/oauth/google/callback", async (req, reply) => {
    const cfg = googleOAuthConfigFromEnv();
    if (!cfg) return reply.code(500).send("Google OAuth not configured");
    if (req.query.error || !req.query.code || !req.query.state) return reply.code(400).send(`OAuth failed: ${req.query.error ?? "missing code"}`);
    const creds = await exchangeGoogleCode(cfg, req.query.code);
    const client = await prisma.client.update({ where: { id: req.query.state }, data: { googleCalendar: { ...creds } } });
    return reply.type("text/html").send(`<h2>Google Calendar connected for ${client.name}.</h2><p>You can close this tab.</p>`);
  });
};
