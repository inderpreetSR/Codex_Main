import { useEffect, useRef, useState } from "react";
import { download, json, poll, type Features, type Plan, type Project, type Request, type Upload } from "./api";
import { FeaturesPanel, type Analysis } from "./features";

import { SuggestionPanel, UploadPanel, type PanelProps, type Runner } from "./panels";
type Source = { id: string; source: string; location: string; body: string };
type Answer = { answer?: string; sources: Source[] };
const tabs = ["Plan", "Features", "Results", "Knowledge"] as const;
type Tab = typeof tabs[number];

export function Workspace({ project, update, request, credentials, close }: {
  project: Project; update: (project: Project) => void; request: Request; credentials: () => Promise<[string, string]>; close: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Plan");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const path = "/projects/" + project.id;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      request<Upload[]>(path + "/uploads", { signal: controller.signal }),
      request<Analysis | null>(path + "/results/latest", { signal: controller.signal }),
    ]).then(([files, result]) => { setUploads(files); setAnalysis(result); })
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [path, request]);

  const run: Runner = async (work, working = "Working…") => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true); setMessage(working); setError("");
    try {
      await work(controller.signal);
      if (!controller.signal.aborted) setMessage("Done.");
    } catch (failure) {
      if (!controller.signal.aborted) { setError((failure as Error).message); setMessage(""); }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  function upload(file: File) {
    run(async (signal) => {
      const form = new FormData();
      form.set("file", file);
      const result = await request<{ job_id: string }>(path + "/uploads", { method: "POST", body: form, signal });
      try { await poll(request, result.job_id, signal); }
      finally { if (!signal.aborted) setUploads(await request<Upload[]>(path + "/uploads", { signal })); }
    }, "Processing " + file.name + "…");
  }

  function remove(file: Upload) {
    if (!window.confirm("Delete " + file.name + " from this project?")) return;
    run(async (signal) => {
      await request(path + "/uploads/" + file.id, { method: "DELETE", signal });
      setUploads((previous) => previous.filter((item) => item.id !== file.id));
    });
  }

  function exportFile(kind: "plan" | "features") {
    run(async () => { const [token, session] = await credentials(); await download(project.id, kind, token, session); });
  }

  const shared = { path, request, run, busy };
  return <section>
    <button className="quiet back" disabled={busy} onClick={close}>← My projects</button>
    <div className="section-title"><span className="eyebrow">{project.task}</span><h1>{project.title}</h1><p>{project.description}</p></div>
    <nav className="tabs" aria-label="Project sections">{tabs.map((item) =>
      <button key={item} className={item === tab ? "active" : "quiet"} aria-current={item === tab ? "page" : undefined}
        disabled={busy} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {message && <p className="message" role="status">{message}</p>}
    {error && <p className="message error" role="alert">{error}</p>}
    {tab === "Plan" && <PlanPanel {...shared} initial={project.plan} save={(plan) => update({ ...project, plan })}
      exportFile={() => exportFile("plan")} />}
    {tab === "Features" && <FeaturesPanel {...shared} project={project} uploads={uploads.filter((item) => item.kind === "csv")}
      save={(features: Features) => update({ ...project, features })} upload={upload} remove={remove}
      exportFile={() => exportFile("features")} onBaseline={(result) => { setAnalysis(result); setTab("Results"); }} />}
    {tab === "Results" && <Results analysis={analysis} />}
    {tab === "Knowledge" && <Knowledge {...shared} consent={project.share_private}
      setConsent={(share_private) => update({ ...project, share_private })}
      uploads={uploads.filter((item) => item.kind === "document")} upload={upload} remove={remove} />}
  </section>;
}

function PlanPanel({ initial, path, request, run, busy, save, exportFile }: PanelProps & {
  initial: Plan; save: (plan: Plan) => void; exportFile: () => void;
}) {
  const [plan, setPlan] = useState(initial);
  const fields: [Exclude<keyof Plan, "steps">, string][] = [
    ["objective", "Objective"], ["explanation", "Explanation"], ["evaluation", "Evaluation"],
    ["strengths", "Strengths"], ["weaknesses", "Weaknesses"], ["opportunities", "Opportunities"], ["threats", "Threats"],
  ];
  return <article className="card stack">
    <h2>Project plan</h2>
    <div className="form-grid">{fields.map(([key, label]) => <label key={key}>{label}
      <textarea rows={3} maxLength={4000} value={plan[key]} onChange={(event) => setPlan({ ...plan, [key]: event.target.value })} />
    </label>)}<label>Steps, one per line<textarea rows={3} value={plan.steps.join("\n")}
      onChange={(event) => setPlan({ ...plan, steps: event.target.value.split("\n") })} /></label></div>
    <div className="actions">
      <button disabled={busy} onClick={() => run(async (signal) => {
        const saved = await request<Plan>(path + "/plan", { ...json("PUT", plan), signal });
        save(saved);
      })}>Save plan</button><button className="quiet" disabled={busy} onClick={exportFile}>Export saved plan</button>
    </div>
    <SuggestionPanel path={path} request={request} run={run} busy={busy} kind="plan" onSuggestion={setPlan} />
  </article>;
}

function Knowledge({ path, request, run, busy, consent, setConsent, uploads, upload, remove }: PanelProps & {
  consent: boolean; setConsent: (enabled: boolean) => void; uploads: Upload[]; upload: (file: File) => void; remove: (file: Upload) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  function ask(mode: "search" | "answer") {
    run(async (signal) => {
      setAnswer(null);
      const queued = await request<{ job_id: string }>(path + "/questions", { ...json("POST", { question, mode }), signal });
      setAnswer(await poll<Answer>(request, queued.job_id, signal));
    }, mode === "search" ? "Searching locally…" : "Retrieving sources and generating an answer…");
  }
  return <article className="card stack"><h2>Project knowledge</h2>
    <UploadPanel uploads={uploads} upload={upload} remove={remove} busy={busy} type="document" />
    <label className="checkbox"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => {
      const enabled = event.target.checked;
      run(async (signal) => {
        await request(path + "/consent", { ...json("PUT", { share_private: enabled }), signal });
        setConsent(enabled); setAnswer(null);
      });
    }} />Allow OpenRouter to receive relevant private excerpts for this project</label>
    <p>Local search stays on this PC. Asking AI sends your question and relevant guides to OpenRouter. Private excerpts are included only when sharing is enabled.</p>
    <label>Question<textarea maxLength={1500} value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
    <div className="actions"><button className="quiet" disabled={busy || !question.trim()} onClick={() => ask("search")}>Search locally</button>
      <button disabled={busy || !question.trim()} onClick={() => ask("answer")}>Ask AI</button></div>
    {answer && <section className="subpanel stack"><h3>{answer.answer ? "Answer" : "Search results"}</h3>
      {answer.answer && <p className="preserve">{answer.answer}</p>}
      {answer.sources.length === 0 && !answer.answer && <p>No relevant sources found.</p>}
      {answer.sources.length > 0 && <ol className="sources">{answer.sources.map((source) => <li key={source.id}>
        <a href={"#source-" + source.id}>{source.source} · {source.location}</a>
      </li>)}</ol>}
      {answer.sources.map((source) => <article id={"source-" + source.id} key={source.id} className="source">
        <strong>{source.source} · {source.location}</strong><p className="preserve">{source.body}</p>
      </article>)}</section>}
  </article>;
}

function Results({ analysis }: { analysis: Analysis | null }) {
  if (!analysis) return <article className="card stack"><h2>Baseline results</h2><p>Run a baseline from Features to compare models here.</p></article>;
  return <article className="card stack"><h2>Baseline results</h2>
    <p>{analysis.training_rows} training rows · {analysis.holdout_rows} holdout rows · {analysis.excluded_missing_targets} missing targets excluded</p>
    <div className="table-scroll"><table><thead><tr><th>Model</th><th>Metric</th><th>Value</th></tr></thead>
      <tbody>{Object.entries(analysis.metrics).flatMap(([model, metrics]) => Object.entries(metrics).map(([metric, value]) =>
        <tr key={model + metric}><td>{model}</td><td>{metric.replaceAll("_", " ")}</td><td>{value.toFixed(3)}</td></tr>))}</tbody>
    </table></div>
    <h3>Held-out permutation importance</h3><p>Changes in holdout performance for the selected model.</p>
    <div className="table-scroll"><table><thead><tr><th>Feature</th><th>Mean</th><th>Std. dev.</th></tr></thead><tbody>
      {analysis.importance.map((item) => <tr key={item.feature}><td>{item.feature}</td><td>{item.mean.toFixed(3)}</td><td>{item.std.toFixed(3)}</td></tr>)}
    </tbody></table></div>
  </article>;
}
