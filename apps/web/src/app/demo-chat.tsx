"use client";

import { useState, type FormEvent } from "react";
import { DEMO_SLUG, publicFetch } from "@/lib/api";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

export function DemoChat() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("ACTIVE");

  async function submitForm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await publicFetch<{ conversationId: string; opener: string }>("/leads", {
        method: "POST",
        body: JSON.stringify({ clientSlug: DEMO_SLUG, name, phone, email: email || undefined, message: message || undefined }),
      });
      setConversationId(res.conversationId);
      setMsgs([{ role: "assistant", text: res.opener || "(The agent sent its opener by SMS.)" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!conversationId || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const res = await publicFetch<{ reply: string; status: string; skipped: string | null }>(
        `/conversations/${conversationId}/messages`,
        { method: "POST", body: JSON.stringify({ text }) },
      );
      setStatus(res.status);
      if (res.reply) setMsgs((m) => [...m, { role: "assistant", text: res.reply }]);
      else if (res.skipped === "human_takeover") setMsgs((m) => [...m, { role: "assistant", text: "(A human has taken over this conversation.)" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <form className="panel" onSubmit={submitForm}>
        <strong>Book a free Strategy Call</strong>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Sam Rivera" />
        <label>Phone (we text you)</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+1 555 000 1111" />
        <label>Email (optional, for the calendar invite)</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="sam@example.com" />
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required style={{ width: "auto", marginTop: 4 }} />
          <span>
            Text me about my call. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
          </span>
        </label>
        <label>What do you want help with?</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="I run a fitness coaching business at ~$6k/mo and want to get to $15k." />
        <button type="submit" disabled={busy || !consent || Boolean(conversationId)}>
          {conversationId ? "Submitted" : busy ? "Sending..." : "Get my call booked"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>

      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Conversation</strong>
          <span className="badge">{conversationId ? status : "waiting for form"}</span>
        </div>
        <div className="chat">
          {msgs.length === 0 && <span className="muted">Submit the form to start.</span>}
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.text}
            </div>
          ))}
          {busy && conversationId && <div className="bubble assistant muted">typing...</div>}
        </div>
        <form className="row" onSubmit={send}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply as the lead..." disabled={!conversationId || busy} />
          <button type="submit" disabled={!conversationId || busy}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
