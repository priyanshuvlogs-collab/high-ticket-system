# BookedAI — AI appointment setter for high-ticket coaches

Built by Hustle Buddies. A lead texts in (or fills a form), the agent replies in seconds, asks 3–4 qualifying questions, and books a call straight onto the coach's calendar. Reminders and no-show rebooking are automatic. A human can take over any conversation from the dashboard.

**Sold as:** $5,000 one-time setup, or $1,000/month with a 30-day trial.

## What's in the box

```
apps/api            Fastify API: Twilio webhook, web-form endpoint, dashboard API, Google OAuth, job scheduler
apps/web            Next.js: demo lead form + chat, owner dashboard (take over / reply / mark no-show)
packages/agent      Claude agent: per-client config, system prompt, tools, conversation loop, lead scoring
packages/db         Prisma schema (Client, Lead, Conversation, Message, Booking)
packages/integrations  Twilio, Google Calendar (OAuth + free/busy + Meet links), mock calendar, GHL webhook push
scripts/            seed-demo-client.ts (one-command demo), demo-chat.ts (terminal demo, no DB needed)
```

### How the agent works

- Model: `claude-opus-5-5` with adaptive thinking, effort `medium` for chat turns (latency matters on SMS). Swap via `AGENT_MODEL`.
- The per-client system prompt (offer, pricing, FAQ, qualification rubric, rules) is a **cached** block; lead context comes after it. Second turn onward reads from cache.
- Tools (strict JSON schemas): `get_availability`, `book_slot`, `update_lead`, `handoff_to_human`, `end_conversation`. `book_slot` only accepts a start time that `get_availability` just returned, so the model can't invent a time.
- Full content blocks of every turn are stored and replayed verbatim (append-only history).
- At `end_conversation`, a structured-output call scores the lead 0–100 with reasons/objections for the owner.
- On `stop_reason: "refusal"` the lead gets a polite hold message and the owner is alerted.

## Quick start (local)

```bash
cp .env.example .env            # fill DATABASE_URL, ANTHROPIC_API_KEY, ADMIN_TOKEN
pnpm install
pnpm db:push                    # creates tables
pnpm seed:demo                  # seeds "Scale Studio Coaching" demo client (slug: demo-coach)
pnpm dev                        # api on :4000, web on :3000
```

Open http://localhost:3000, submit the form as a lead, chat. Open http://localhost:3000/dashboard with your `ADMIN_TOKEN`.

No database handy? Run the agent in the terminal: `pnpm demo:chat` (needs only `ANTHROPIC_API_KEY`).

### SMS demo number (US)

```bash
ngrok http 4000                                   # dev only; copy the https URL into API_PUBLIC_URL in .env
pnpm twilio:setup --dry-run                       # see 5 available toll-free numbers, buy nothing
pnpm twilio:setup                                 # pick one -> buys it, sets its webhook, attaches it to demo-coach
pnpm twilio:setup --type local --area 305         # local number instead of toll-free
pnpm twilio:setup --attach +18885551234           # re-sync webhook on a number you already own (after ngrok URL changes)
```

Needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `API_PUBLIC_URL` in `.env` and an **upgraded (paid) Twilio account**. Add `DEMO_OWNER_PHONE=+1...` to `.env` and re-run `pnpm seed:demo` to receive handoff alerts by text.

**US SMS does not deliver until the number is registered.** Twilio enforces this.

| | Toll-free (use this for the demo) | Local (10DLC) |
|---|---|---|
| Registration | Toll-Free Verification: free, one form | A2P brand ($4) + campaign (~$15 + monthly), EIN required |
| Typical wait | 1-5 business days | Days to weeks |
| Until approved | Outbound SMS blocked | Filtered / blocked |

Submit verification right after buying: Twilio Console → Phone Numbers → Regulatory Compliance → Toll-Free Verification. Suggested answers:

- Business: Hustle Buddies (your website / social link). Use case: *Appointment scheduling and lead follow-up*.
- Opt-in: *Lead submits a web form with their phone number and ticks "Text me about my call" consent.* Attach a screenshot of the demo form at `/`.
- Monthly volume: 1,000. Sample messages:
  - "Hi Sam, this is Alex with Scale Studio Coaching. You asked about a Strategy Call. Quick one: what do you sell right now, and roughly what's it bringing in per month? Reply STOP to opt out."
  - "You're booked for Thu Oct 9, 3:00 PM ET. Calendar invite is on its way. Reply if anything changes."

While you wait, demo on the web chat at `/`. STOP/HELP replies are handled by Twilio automatically on toll-free and 10DLC numbers; the agent also closes the conversation on "stop".

### Google Calendar (real bookings)

1. Create OAuth credentials in Google Cloud (Calendar API enabled), redirect URI `<API_PUBLIC_URL>/oauth/google/callback`.
2. Set `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`.
3. Visit `<API_PUBLIC_URL>/oauth/google/start?clientSlug=demo-coach&token=<ADMIN_TOKEN>` and approve.

Until a client has Google connected, the **mock calendar** is used (bookings still show in the dashboard). Force with `CALENDAR_PROVIDER=mock|google`.

### Jobs (reminders, no-show rebooking)

- With `REDIS_URL` set: BullMQ. Run `pnpm dev:worker` alongside the API.
- Without: in-process timers in the API, and in dev the schedule is compressed (24h reminder → 20s, 1h → 40s, no-show check → 60s) so you can watch it.

## Onboarding a real client (Phase 1, by hand)

`PUT /admin/clients` with `Authorization: Bearer <ADMIN_TOKEN>` and a body matching `ClientConfigSchema` in `packages/agent/src/config.ts`. Copy `packages/agent/src/demo-config.ts` as the template: offer, pricing the agent may state, ideal client, FAQ, qualification questions with pass rules, working hours. Then attach their Twilio number and connect Google. That's the whole setup; the wizard comes in Phase 2.

Optional: set `ghlWebhookUrl` on the client to push `booking.created`, `booking.no_show`, `lead.needs_human` into a GoHighLevel inbound-webhook workflow.

## Tests

```bash
pnpm test        # agent scenario tests (qualified → booked, unqualified → closed, angry → handoff, guardrails, slot generation)
pnpm typecheck
```

Tests run against a scripted fake of the Claude API, so they're free and deterministic. For a live smoke test use `pnpm demo:chat`.

## Roadmap

- **Phase 2 (after first paying trial):** Stripe ($1k/mo w/ 30-day trial, $5k setup), onboarding wizard, nightly report email, eval set of 20 scripted leads.
- **Phase 3 (after 3 clients):** Instagram/FB DMs, voice callback for missed calls, one-click client cloning.
