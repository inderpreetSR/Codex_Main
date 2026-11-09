import { useCallback, useEffect, useState } from "react";
import type { Request } from "./api";

type User = { owner: string; last_sign_in: string; active_sessions: number; is_admin: boolean };
type Session = { id: string; owner: string; created_at: string; last_activity: string };
type Event = { created_at: string; event: string; actor: string; target: string };
type Overview = { projects: number; active_sessions: number; session_events_24h: number; active_jobs: number };

export function Admin({ request, close }: { request: Request; close: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [nextOverview, nextUsers, nextSessions, nextEvents] = await Promise.all([
      request<Overview>("/admin/overview"), request<User[]>("/admin/users"),
      request<Session[]>("/admin/sessions"), request<Event[]>("/admin/events"),
    ]);
    setOverview(nextOverview); setUsers(nextUsers); setSessions(nextSessions); setEvents(nextEvents);
  }, [request]);
  useEffect(() => { void refresh().catch((failure: Error) => setError(failure.message)); }, [refresh]);

  async function endSession(session: Session) {
    if (!window.confirm("End this workspace session for " + session.owner + "?")) return;
    setBusy(true); setError("");
    try { await request("/admin/sessions/" + session.id, { method: "DELETE" }); await refresh(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="dashboard stack"><button className="quiet back" onClick={close}>← Back to workspace</button>
    <div className="section-title"><span className="eyebrow">Administration</span><h1>Workspace administration</h1>
      <p>Local operational information. Lists show at most 100 recent records.</p></div>
    {error && <p className="message error" role="alert">{error}</p>}
    <button className="quiet" disabled={busy} onClick={() => void refresh().catch((failure: Error) => setError(failure.message))}>Refresh</button>
    {overview && <div className="cards">
      <article className="card"><h2>Projects</h2><p>{overview.projects}</p></article>
      <article className="card"><h2>Active sessions</h2><p>{overview.active_sessions}</p></article>
      <article className="card"><h2>Session events, last 24 hours</h2><p>{overview.session_events_24h}</p></article>
      <article className="card"><h2>Queued or running jobs</h2><p>{overview.active_jobs}</p></article>
    </div>}
    <article className="card stack"><h2>Accounts and roles</h2><p>Accounts appear after they sign in. Identities are Auth0 issuer and user ID, not email addresses. To grant or remove an administrator role, follow the local operator commands in the repository README.</p>
      <div className="table-scroll"><table><thead><tr><th>Account identity</th><th>Role</th><th>Active sessions</th><th>Last sign-in</th></tr></thead>
        <tbody>{users.map((user) => <tr key={user.owner}><td>{user.owner}</td><td>{user.is_admin ? "Administrator" : "User"}</td><td>{user.active_sessions}</td><td>{new Date(user.last_sign_in).toLocaleString()}</td></tr>)}</tbody></table></div>
    </article>
    <article className="card stack"><h2>Active sessions</h2><p>Ending a session may discard unsaved work. An unexpired Auth0 token may still be used to create a new session.</p>
      <div className="table-scroll"><table><thead><tr><th>Account identity</th><th>Last activity</th><th>Action</th></tr></thead><tbody>{sessions.map((session) =>
        <tr key={session.id}><td>{session.owner}</td><td>{new Date(session.last_activity).toLocaleString()}</td><td><button className="quiet" disabled={busy} onClick={() => void endSession(session)}>End session</button></td></tr>)}</tbody></table></div>
    </article>
    <article className="card stack"><h2>Recent audit events</h2><p>Session and role events only; Auth0 maintains its own authentication logs.</p>
      <div className="table-scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Account</th></tr></thead><tbody>{events.map((event, index) =>
        <tr key={event.created_at + event.event + index}><td>{new Date(event.created_at).toLocaleString()}</td><td>{event.event}</td><td>{event.actor}</td><td>{event.target}</td></tr>)}</tbody></table></div>
    </article>
  </section>;
}
