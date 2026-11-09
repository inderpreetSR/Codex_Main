import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { get, json, type Config, type Guide, type Project, type Request, type Task } from "./api";
import { Workspace } from "./workspace";
import { Admin } from "./admin";
import "./styles.css";

const sessionCreations = new Map<string, Promise<string>>();

async function workspaceSession(token: string, sessionStorageKey: string): Promise<string> {
  const existing = sessionStorage.getItem(sessionStorageKey);
  if (existing) return existing;
  let pending = sessionCreations.get(sessionStorageKey);
  if (!pending) {
    pending = get<{ session_key: string }>("/session", { method: "POST" }, token)
      .then(({ session_key }) => { sessionStorage.setItem(sessionStorageKey, session_key); return session_key; })
      .finally(() => { sessionCreations.delete(sessionStorageKey); });
    sessionCreations.set(sessionStorageKey, pending);
  }
  return pending;
}

function Shell({ children, account }: { children: React.ReactNode; account?: React.ReactNode }) {
  return <>
    <header className="top"><a className="brand" href="/"><span className="mark">C</span> Codex Main</a>
      <div className="top-right"><a href="/welcome/">Welcome page</a>{account}</div>
    </header>
    <main>{children}</main>
    <footer>Codex Main · Data Science &amp; ML Workspace</footer>
  </>;
}

function Library({ guides, create }: { guides: Guide[]; create?: (guide: Guide) => void }) {
  return <section aria-labelledby="library-title">
    <div className="section-title"><span className="eyebrow">Explore</span><h2 id="library-title">Use-case library</h2></div>
    <div className="cards">{guides.map((guide, index) => <article className="card" key={guide.id}>
      <span className="eyebrow">0{index + 1} / {guide.task ?? "Guide"}</span>
      <h3>{guide.title}</h3><p>{guide.description}</p>
      <details><summary>Read guide</summary>{Object.entries(guide.sections).map(([title, content]) =>
        <div key={title} className="guide-section"><strong>{title}</strong><p>{content}</p></div>)}</details>
      {guide.task && create && <button className="quiet" onClick={() => create(guide)}>Start a project</button>}
    </article>)}</div>
  </section>;
}

function Intro({ guides, action }: { guides: Guide[]; action: React.ReactNode }) {
  return <>
    <section className="hero">
      <span className="eyebrow">Local research workspace</span>
      <h1>Data science projects</h1>
      <p>Plan your analysis, design features, compare baseline models, and ask questions grounded in your project documents.</p>
      {action}
    </section>
    <Library guides={guides} />
  </>;
}

function SignedIn({ guides }: { guides: Guide[] }) {
  const auth = useAuth0();
  const sessionStorageKey = "codex-workspace-session:" + (auth.user?.sub ?? "unknown");
  const getToken = auth.getAccessTokenSilently;
  const token = useCallback(async () => {
    const accessToken = await getToken();
    if (!accessToken) throw new Error("Sign in again to continue.");
    return accessToken;
  }, [getToken]);
  const credentials = useCallback(async (): Promise<[string, string]> => {
    const accessToken = await token();
    return [accessToken, await workspaceSession(accessToken, sessionStorageKey)];
  }, [token, sessionStorageKey]);
  const request = useCallback<Request>(async (path, options) => {
    const [accessToken, session] = await credentials();
    return get(path, options, accessToken, session);
  }, [credentials]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [task, setTask] = useState<Task>("classification");
  const [guide, setGuide] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    request<Project[]>("/projects", { signal: controller.signal }).then(setProjects)
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    request<{ is_admin: boolean }>("/account", { signal: controller.signal }).then((result) => setIsAdmin(result.is_admin))
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [request]);

  function startFrom(item: Guide) {
    if (!item.task) return;
    setTitle(item.title); setDescription(item.description); setTask(item.task); setGuide(item.id);
    document.getElementById("project-title")?.focus();
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const created = await request<Project>("/projects", json("POST", { title, description, task, guide }));
      setProjects((previous) => [created, ...previous]); setProject(created);
      setTitle(""); setDescription(""); setGuide(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function update(next: Project) {
    setProject(next);
    setProjects((previous) => previous.map((item) => item.id === next.id ? next : item));
  }

  async function signOut() {
    try {
      const accessToken = await token();
      const session = sessionStorage.getItem(sessionStorageKey);
      if (session) await get("/session", { method: "DELETE" }, accessToken, session);
      sessionStorage.removeItem(sessionStorageKey);
      await auth.logout({ logoutParams: { returnTo: window.location.origin } });
    } catch (failure) {
      setError("Could not end the workspace session. Try again. " + (failure as Error).message);
    }
  }

  return <Shell account={<>{isAdmin && !project && <button className="quiet" onClick={() => setAdminOpen(true)}>Admin</button>}
    <button className="quiet" onClick={() => void signOut()}>Sign out</button></>}>
    {error && <p className="message error" role="alert">{error}</p>}
    {adminOpen ? <Admin request={request} close={() => setAdminOpen(false)} /> : project ? <Workspace key={project.id} project={project} update={update} request={request}
      credentials={credentials} close={() => setProject(null)} /> : <>
      <section className="dashboard"><div className="section-title"><span className="eyebrow">Workspace</span><h1>My projects</h1></div>
        <div className="dashboard-grid">
          <form className="card stack" onSubmit={create}>
            <h2>New project</h2>
            <label>Project name<input id="project-title" value={title} maxLength={160} required
              onChange={(event) => setTitle(event.target.value)} /></label>
            <label>Problem statement<textarea value={description} maxLength={4000}
              onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Task<select value={task} onChange={(event) => { setTask(event.target.value as Task); setGuide(null); }}>
              <option value="classification">Classification</option><option value="regression">Regression</option>
            </select></label>
            <button disabled={saving}>Create project</button>
          </form>
          <div className="card stack"><h2>Saved projects</h2>{projects.length === 0 && <p>Your projects will appear here.</p>}
            {projects.map((item) => <button className="project-link" key={item.id} onClick={() => setProject(item)}>
              <strong>{item.title}</strong><span>{item.task}</span></button>)}
          </div>
        </div>
      </section>
      <Library guides={guides} create={startFrom} />
    </>}
  </Shell>;
}

function Login({ guides }: { guides: Guide[] }) {
  const auth = useAuth0();
  if (auth.isLoading) return <Shell><p className="message" role="status">Checking sign-in…</p></Shell>;
  if (auth.isAuthenticated) return <SignedIn guides={guides} />;
  return <Shell><Intro guides={guides} action={<>
    {auth.error && <p className="message error" role="alert">Sign-in failed. Try again.</p>}
    <button onClick={() => void auth.loginWithRedirect()}>Sign in to your workspace</button>
  </>} /></Shell>;
}

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([get<Config>("/config", { signal: controller.signal }), get<Guide[]>("/guides", { signal: controller.signal })])
      .then(([settings, items]) => { setConfig(settings); setGuides(items); })
      .catch(() => { if (!controller.signal.aborted) setError("The API is unavailable on port 8000."); });
    return () => controller.abort();
  }, []);

  if (config?.domain && config.clientId && config.audience) {
    return <Auth0Provider domain={config.domain} clientId={config.clientId}
      authorizationParams={{ redirect_uri: window.location.origin, audience: config.audience }}
      cacheLocation="memory"><Login guides={guides} /></Auth0Provider>;
  }
  return <Shell><Intro guides={guides} action={error ? <div className="actions">
    <span role="alert">{error}</span><button onClick={() => window.location.reload()}>Retry</button>
  </div> : <p className="message" role="status">{config
    ? "Set up Auth0 in your local environment to enable sign-in and private projects."
    : "Connecting to the local API…"}</p>} /></Shell>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
