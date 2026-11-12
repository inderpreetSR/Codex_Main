import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { get, json, type Config, type Guide, type Project, type Request, type Task } from "./api";
import { Workspace } from "./workspace";
import { LearningJourney } from "./learning";
import { Admin } from "./admin";
import { WorkspaceMark } from "./workspace-mark";
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
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try { return localStorage.getItem("codex-theme") === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("codex-theme", theme); } catch { /* Storage may be unavailable. */ }
  }, [theme]);
  return <>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="top"><div className="top-inner"><a className="brand" href="/" aria-label="Codex Main home">
      <span className="mark"><WorkspaceMark kind="pipeline" /></span>
      <span>codex<span className="brand-accent">.</span>main<small>DATA SCIENCE WORKSPACE</small></span></a>
      <nav className="main-nav" aria-label="Main navigation">
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("codex-navigate", { detail: "home" }))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5M5.5 9v11h13V9M9.5 20v-6h5v6" /></svg>Home</button>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("codex-navigate", { detail: "learn" }))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" /></svg>Use cases</button>
        {account && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("codex-navigate", { detail: "projects" }))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z" /></svg>My projects</button>}
      </nav>
      <div className="top-right"><a className="header-link" href="/welcome/">Welcome page <span aria-hidden="true">↗</span></a><button className="quiet theme-toggle" type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Dark mode" : "Light mode"}</button>{account}</div></div>
    </header>
    <main id="main-content">{children}</main>
    <footer><span>codex<span className="brand-accent">.</span>main</span><span>Built for thoughtful analysis.</span></footer>
  </>;
}

function Library({ guides, create, learn }: { guides: Guide[]; create?: (guide: Guide) => void; learn: (guide: Guide) => void }) {
  return <section aria-labelledby="library-title">
    <div className="section-heading"><div className="section-title"><span className="eyebrow">THE LIBRARY</span><h2 id="library-title" className="icon-heading"><WorkspaceMark kind="learning" />Explore use cases</h2><p>Start with a familiar problem, then make it your own.</p></div><span className="section-count">{guides.length} GUIDES</span></div>
    <div className="cards guide-cards">{guides.map((guide, index) => <article className="card guide-card" key={guide.id}>
      <div className="guide-meta"><span className="guide-icon" aria-hidden="true">{["↗", "◎", "▥", "∿", "◌"][index % 5]}</span><span className="guide-number">0{index + 1}</span></div>
      <span className="guide-tag">{guide.task ?? "Guide"}</span><h3>{guide.title}</h3><p>{guide.description}</p>
      <button className="quiet guide-start" type="button" onClick={() => learn(guide)}>Explore guide →</button>
      {guide.task && create && <button className="quiet guide-start" onClick={() => create(guide)}>Start a project <span aria-hidden="true">↗</span></button>}
    </article>)}</div>
  </section>;
}

function Intro({ guides, action }: { guides: Guide[]; action: React.ReactNode }) {
  const [learning, setLearning] = useState<Guide | null>(null);
  useEffect(() => {
    function navigate(event: Event) {
      const destination = (event as CustomEvent<string>).detail;
      setLearning(null);
      requestAnimationFrame(() => document.getElementById(destination === "learn" ? "library-title" : "main-content")?.scrollIntoView());
    }
    window.addEventListener("codex-navigate", navigate);
    return () => window.removeEventListener("codex-navigate", navigate);
  }, []);
  if (learning) return <LearningJourney key={learning.id} guide={learning} close={() => setLearning(null)} signIn={action} />;
  const featured = guides.find((item) => item.id === "churn") ?? guides[0];
  return <>
    <section className="hero">
      <div className="hero-content"><span className="eyebrow"><span className="status-dot" aria-hidden="true"></span> YOUR DATA SCIENCE WORKSPACE</span>
      <h1>Start with<br/><span>a question.</span></h1>
      <p>Learn the concepts, explore a use case, and build thoughtful experiments at your own pace.</p>
      <div className="hero-action actions">{featured && <button onClick={() => setLearning(featured)}>Explore {featured.title} →</button>}{action}</div></div>
      <div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one"></div><div className="art-orbit orbit-two"></div><div className="art-core"><WorkspaceMark kind="pipeline" /></div><i className="art-dot dot-one"></i><i className="art-dot dot-two"></i><i className="art-dot dot-three"></i><div className="art-caption">EXPLORE <span>→</span> EXPERIMENT <span>→</span> UNDERSTAND</div></div>
    </section>
    <Library guides={guides} learn={setLearning} />
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
  const [learning, setLearning] = useState<Guide | null>(null);
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

  useEffect(() => {
    function navigate(event: Event) {
      const destination = (event as CustomEvent<string>).detail;
      if (project && !window.confirm("Leave this project? Unsaved changes may be lost.")) return;
      setProject(null); setLearning(null); setAdminOpen(false);
      requestAnimationFrame(() => document.getElementById(destination === "learn" ? "library-title" : "main-content")?.scrollIntoView());
    }
    window.addEventListener("codex-navigate", navigate);
    return () => window.removeEventListener("codex-navigate", navigate);
  }, [project]);

  function startFrom(item: Guide) {
    if (!item.task) return;
    setLearning(null); setTitle(item.title); setDescription(item.description); setTask(item.task); setGuide(item.id);
    requestAnimationFrame(() => document.getElementById("project-title")?.focus());
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
    {adminOpen ? <Admin request={request} close={() => setAdminOpen(false)} /> : learning ? <LearningJourney key={learning.id} guide={learning} close={() => setLearning(null)} start={startFrom} /> : project ? <Workspace key={project.id} project={project} update={update} request={request}
      credentials={credentials} close={() => setProject(null)} /> : <>
      <section className="dashboard"><div className="dashboard-heading"><div className="section-title"><span className="eyebrow"><span className="status-dot" aria-hidden="true"></span> YOUR WORKSPACE</span><h1>My projects<span className="heading-period">.</span></h1><p>A little structure for your next big question.</p></div><span className="dashboard-count">{projects.length} {projects.length === 1 ? "PROJECT" : "PROJECTS"}</span></div>
        <div className="dashboard-grid">
          <form className="card stack create-card" onSubmit={create}>
            <div className="panel-heading"><span className="panel-icon" aria-hidden="true">＋</span><div><h2>Start a new project</h2><p>Define the question you want to explore.</p></div></div>
            <label>Project name<input id="project-title" value={title} maxLength={160} required
              onChange={(event) => setTitle(event.target.value)} /></label>
            <label>Problem statement<textarea value={description} maxLength={4000}
              onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Task<select value={task} onChange={(event) => { setTask(event.target.value as Task); setGuide(null); }}>
              <option value="classification">Classification</option><option value="regression">Regression</option>
            </select></label>
            <button disabled={saving}>Create project</button>
          </form>
          <div className="card stack saved-card"><div className="panel-heading"><span className="panel-icon alternate" aria-hidden="true">▦</span><div><h2>Saved projects</h2><p>Pick up where you left off.</p></div></div>{projects.length === 0 && <div className="empty-state"><span className="empty-symbol" aria-hidden="true">✳</span><strong>Nothing here just yet</strong><p>Your projects will appear here once you create one.</p></div>}
            {projects.map((item) => <button className="project-link" key={item.id} onClick={() => setProject(item)}>
              <strong>{item.title}</strong><span>{item.task}</span></button>)}
          </div>
        </div>
      </section>
      <Library guides={guides} create={startFrom} learn={setLearning} />
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
