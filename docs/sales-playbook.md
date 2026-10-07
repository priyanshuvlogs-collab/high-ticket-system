# BookedAI Sales Playbook (Hustle Buddies)

The product is built. Everything from here is reps. This is the script for the next 30 days: get 1 trial, turn it into a case study, then sell the $5,000 setup to the next five.

## The offer, in one breath

"I install an AI setter on your lead flow. Every lead gets a reply in under 60 seconds, 24/7. It asks your qualifying questions, books the good ones straight onto your calendar, reminds them, and chases no-shows. You only talk to people who are already qualified."

- **Setup:** $5,000 one-time, includes 90 days of tuning.
- **Subscription:** $1,000/month, first 30 days free, cancel anytime in the trial.
- **Guarantee:** if it doesn't book 10 qualified calls in the first 60 days, we keep working for free until it does.

Lead with the trial. The $5,000 is for people who already saw it work.

## Who to DM

Coaches, consultants and agency owners who **run ads or post daily to a "book a call" link**. They already pay for leads and lose them to slow follow-up. Find them in: Instagram ads library (search "book a call" + "coaching"), Facebook groups for coaches, LinkedIn "founder" posts with a Calendly link, YouTube ads.

Skip: people with no offer yet, people selling under $1,000, and anyone who "does their own follow-up fine" (they don't, but they won't pay to learn that).

Daily quota: 30 first-touch DMs, 15 follow-ups. Track in a sheet: name, platform, date, status, reply.

## DM scripts

**First touch (Instagram / LinkedIn)**

> Hey {first name}, saw your ad for {offer}. Quick q: when someone fills your form at 11pm, how long until they hear back?
>
> I built an AI setter that replies in 30 seconds, asks your qualifying questions, and books the call on your calendar. Want to text it right now and see? +1 289-819-2433 (it's pretending to be a coach named Jordan).

**If they text the demo and reply "that's cool"**

> That exact flow runs on your offer, your questions, your calendar. I'm doing 3 free 30-day installs this month for coaches running ads. Want one? 20-min call to set it up: {your booking link}

**Follow-up 1 (2 days, no reply)**

> {first name}, no pressure, just curious: roughly how many leads a month come in through that form?

**Follow-up 2 (5 days)**

> Last one from me. If slow follow-up isn't costing you calls, ignore this. If it is, the install takes 20 minutes and the first 30 days are free.

**Cold email subject lines:** "your 11pm leads" / "{Business} + AI setter" / "quick one about {offer}"

## The demo (do this live, 4 minutes)

1. Have them pull out their phone and text the demo number. Don't screen-share it. Them texting is the demo.
2. Narrate: "It's asking your qualifying questions, one at a time, like a good setter would."
3. When it offers time slots: "Those come from a real calendar. Pick one."
4. When it books: open the dashboard on your screen, show the booking and the lead score.
5. Then: "Now imagine that's your offer, your questions, your calendar. That's the install."

If anything misfires during a demo, say "that's the demo coach's config, yours gets tuned" and keep going. Then paste the transcript into the build session afterwards so the prompt gets fixed.

## Objections

| They say | You say |
|---|---|
| "I have a VA for that." | "How fast does she reply at 2am on Sunday? This doesn't replace her, it makes sure nothing waits for her." |
| "AI will sound robotic." | "You just texted it. Did it?" |
| "$1,000 a month is a lot." | "What's a booked call worth to you? One extra close pays for a year. And the first 30 days are free, so the only risk is your 20 minutes." |
| "I need to think about it." | "Totally. What would you need to see in the trial to say yes?" (write the answer down; that's your success metric for the trial) |
| "Can it do Instagram DMs?" | "Form and SMS now, DMs are next. Most of your leads that convert come through the form anyway." |
| "Is my data safe?" | "Leads live in a private database you can export or delete any time. The AI never sees anything you don't put in the config." |

## Trial close

"Here's how the trial works. 20-minute setup call: I need your offer, your pricing, the 3-4 questions you'd ask a lead, and access to your calendar. It's live the same day. For 30 days you pay nothing. At day 30 it's $1,000/month or we switch it off, no hard feelings. Want to grab the setup call now?"

## Onboarding a trial client (your side, 2 hours)

1. Copy `packages/agent/src/demo-config.ts` into their config: offer, pricing you are allowed to state, ideal client, FAQ, qualification questions with pass rules, working hours, timezone.
2. `PUT /admin/clients` with the config (see README "Onboarding a real client").
3. Buy them a number (`pnpm twilio:setup --client their-slug`). US clients: toll-free + verification, submit day one.
4. Connect their Google Calendar (`/oauth/google/start?clientSlug=...`).
5. Put the form on their site, or give them the `POST /leads` endpoint for Zapier/GHL/Typeform.
6. Text it yourself as a fake lead, end to end, before telling them it's live.
7. Week 1: read every transcript daily, tune the config. Week 4: send a one-page results summary (leads, booked, show rate). That page is the case study.

## 10DLC answers for the US number (+1 417-804-3357), when a US client needs it

Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC.

- **Brand:** Hustle Buddies, your EIN, website, business type "Private", vertical "Professional Services".
- **Campaign type:** Low Volume Mixed (or "Customer Care" if offered).
- **Use case description:** "Appointment scheduling and follow-up for leads who submitted a web form requesting a consultation call."
- **Opt-in:** "Lead submits a web form with their phone number and checks 'Text me about my call'." Attach a screenshot of the form.
- **Sample 1:** "Hi Sam, this is Alex with Scale Studio Coaching. You asked about a Strategy Call. Quick one: what do you sell right now, and roughly what's it bringing in per month? Reply STOP to opt out."
- **Sample 2:** "You're booked for Thu Oct 9, 3:00 PM ET. Calendar invite is on its way. Reply if anything changes."
- **Opt-out / help:** Twilio's default STOP/HELP handling is on.

## Weekly scorecard

Fill this every Friday. It tells you which phase you're in and what to fix.

| Metric | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|
| First-touch DMs sent | | | | |
| Replies | | | | |
| Demo texts (people who texted the number) | | | | |
| Setup calls booked | | | | |
| Trials started | | | | |
| MRR | | | | |

Under 10% reply rate: fix the first message. Replies but no demo texts: push the number harder, earlier. Demos but no setup calls: your close is soft; use the trial-close script word for word.

**Next action:** send 30 DMs today with the demo number in them.
