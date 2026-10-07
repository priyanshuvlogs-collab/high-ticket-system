"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch, getAdminToken, setAdminToken } from "@/lib/api";

interface Overview {
  leads: number;
  booked: number;
  needsHuman: number;
  upcoming: Array<{ id: string; startsAt: string; meetingUrl: string | null; lead: { name: string | null; phone: string | null } }>;
}
interface ConvoRow {
  id: string;
  status: "ACTIVE" | "HUMAN_TAKEOVER" | "ENDED";
  channel: string;
  handoffReason: string | null;
  summary: string | null;
  updatedAt: string;
  lead: { id: string; name: string | null; phone: string | null; status: string; score: number | null };
  messages: Array<{ text: string | null; role: string; createdAt: string }>;
}
interface ConvoDetail extends Omit<ConvoRow, "messages"> {
  messages: Array<{ id: string; role: string; text: string | null; createdAt: string }>;
}
interface BookingRow {
  id: string;
  startsAt: string;
  status: string;
  meetingUrl: string | null;
  lead: { name: string | null; phone: string | null; score: number | null };
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function badgeClass(status: string) {
  if (["BOOKED", "QUALIFIED", "SCHEDULED", "REMINDED", "COMPLETED", "ENDED"].includes(status)) return "badge ok";
  if (["NEEDS_HUMAN", "HUMAN_TAKEOVER", "NO_SHOW"].includes(status)) return "badge warn";
  if (["UNQUALIFIED", "CANCELLED"].includes(status)) return "badge bad";
  return "badge";
}

export function Dashboard() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [convos, setConvos] = useState<ConvoRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [open, setOpen] = useState<ConvoDetail | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, c, b] = await Promise.all([
        adminFetch<Overview>("/admin/overview"),
        adminFetch<ConvoRow[]>("/admin/conversations"),
        adminFetch<BookingRow[]>("/admin/bookings"),
      ]);
      setOverview(o);
      setConvos(c);
      setBookings(b);
      setAuthed(true);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") setAuthed(false);
      else setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    setToken(getAdminToken());
    if (getAdminToken()) void load();
  }, [load]);

  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [authed, load]);

  async function openConvo(id: string) {
    setOpen(await adminFetch<ConvoDetail>(`/admin/conversations/${id}`));
  }

  async function act(id: string, action: "takeover" | "resume") {
    await adminFetch(`/admin/conversations/${id}/${action}`, { method: "POST" });
    await load();
    if (open?.id === id) await openConvo(id);
  }

  async function sendReply() {
    if (!open || !reply.trim()) return;
    await adminFetch(`/admin/conversations/${open.id}/reply`, { method: "POST", body: JSON.stringify({ text: reply.trim() }) });
    setReply("");
    await openConvo(open.id);
  }

  async function setBooking(id: string, status: string) {
    await adminFetch(`/admin/bookings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
  }

  if (!authed) {
    return (
      <div className="panel" style={{ maxWidth: 420 }}>
        <strong>Admin token</strong>
        <p className="muted">Phase 1 auth. Paste the ADMIN_TOKEN from the API .env.</p>
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="ADMIN_TOKEN" />
        <button
          onClick={() => {
            setAdminToken(token);
            void load();
          }}
        >
          Open dashboard
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  return (
    <>
      {overview && (
        <div className="stats">
          <div className="stat">
            <div className="n">{overview.leads}</div>
            <div className="l">Leads handled</div>
          </div>
          <div className="stat">
            <div className="n">{overview.booked}</div>
            <div className="l">Calls booked</div>
          </div>
          <div className="stat">
            <div className="n" style={{ color: overview.needsHuman ? "var(--warn)" : undefined }}>
              {overview.needsHuman}
            </div>
            <div className="l">Need you</div>
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="grid">
        <div className="panel">
          <strong>Conversations</strong>
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Status</th>
                <th>Last message</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {convos.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a onClick={() => void openConvo(c.id)} style={{ cursor: "pointer" }}>
                      {c.lead.name ?? c.lead.phone ?? "Unknown"}
                    </a>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {c.lead.phone} {c.lead.score != null ? `· score ${c.lead.score}` : ""}
                    </div>
                  </td>
                  <td>
                    <span className={badgeClass(c.status === "ENDED" ? c.lead.status : c.status)}>
                      {c.status === "ENDED" ? c.lead.status : c.status}
                    </span>
                    {c.handoffReason && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.handoffReason}
                      </div>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {c.messages[0]?.text?.slice(0, 80) ?? c.summary?.slice(0, 80) ?? ""}
                  </td>
                  <td>
                    {c.status === "HUMAN_TAKEOVER" ? (
                      <button className="secondary" style={{ marginTop: 0 }} onClick={() => void act(c.id, "resume")}>
                        Hand back
                      </button>
                    ) : (
                      <button className="secondary" style={{ marginTop: 0 }} onClick={() => void act(c.id, "takeover")}>
                        Take over
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {convos.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No conversations yet. Submit the demo form.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          {open ? (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{open.lead.name ?? open.lead.phone}</strong>
                <span className={badgeClass(open.status)}>{open.status}</span>
              </div>
              {open.summary && <p className="muted">{open.summary}</p>}
              <div className="chat">
                {open.messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.role === "USER" ? "user" : "assistant"}`}>
                    {m.text}
                  </div>
                ))}
              </div>
              {open.status === "HUMAN_TAKEOVER" ? (
                <div className="row">
                  <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply as the owner (sent by SMS)..." />
                  <button onClick={() => void sendReply()}>Send</button>
                </div>
              ) : (
                <p className="muted">Agent is handling this. Click &quot;Take over&quot; to reply yourself.</p>
              )}
            </>
          ) : (
            <>
              <strong>Bookings</strong>
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Lead</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {fmt(b.startsAt)}
                        {b.meetingUrl && (
                          <div>
                            <a href={b.meetingUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                              join link
                            </a>
                          </div>
                        )}
                      </td>
                      <td>
                        {b.lead.name ?? b.lead.phone}
                        {b.lead.score != null && <div className="muted" style={{ fontSize: 12 }}>score {b.lead.score}</div>}
                      </td>
                      <td>
                        <span className={badgeClass(b.status)}>{b.status}</span>
                      </td>
                      <td>
                        {["SCHEDULED", "REMINDED"].includes(b.status) && (
                          <>
                            <button className="secondary" style={{ marginTop: 0, marginRight: 6 }} onClick={() => void setBooking(b.id, "COMPLETED")}>
                              Showed
                            </button>
                            <button className="secondary" style={{ marginTop: 0 }} onClick={() => void setBooking(b.id, "NO_SHOW")}>
                              No-show
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {bookings.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No bookings yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
          {open && (
            <button className="secondary" onClick={() => setOpen(null)}>
              Back to bookings
            </button>
          )}
        </div>
      </div>
    </>
  );
}
