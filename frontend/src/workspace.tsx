import { WorkspaceMark } from "./workspace-mark";
import { useEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  decisionsByArea, download, improvementAreas, json, poll,
  type Features, type ImprovementArea, type Plan, type Project, type Request, type SpellingField, type Upload,
} from "./api";
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
    <Tabs.Root value={tab} onValueChange={(value) => setTab(value as Tab)}>
      <Tabs.List className="tabs" aria-label="Project sections">{tabs.map((item) =>
        <Tabs.Trigger key={item} value={item} disabled={busy}>{item}</Tabs.Trigger>)}</Tabs.List>
      {message && <p className="message" role="status">{message}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      <Tabs.Content value="Plan"><PlanPanel {...shared} initial={project.plan} save={(plan) => update({ ...project, plan })}
        exportFile={() => exportFile("plan")} /></Tabs.Content>
      <Tabs.Content value="Features"><FeaturesPanel {...shared} project={project} uploads={uploads.filter((item) => item.kind === "csv")}
        save={(features: Features) => update({ ...project, features })} upload={upload} remove={remove}
        exportFile={() => exportFile("features")} onBaseline={(result) => { setAnalysis(result); setTab("Results"); }} /></Tabs.Content>
      <Tabs.Content value="Results"><Results analysis={analysis} /></Tabs.Content>
      <Tabs.Content value="Knowledge"><Knowledge {...shared} consent={project.share_private}
        setConsent={(share_private) => update({ ...project, share_private })}
        uploads={uploads.filter((item) => item.kind === "document")} upload={upload} remove={remove} /></Tabs.Content>
    </Tabs.Root>
  </section>;
}

function PlanPanel({ initial, path, request, run, busy, save, exportFile }: PanelProps & {
  initial: Plan; save: (plan: Plan) => void; exportFile: () => void;
}) {
  const [plan, setPlan] = useState<Plan>(() => ({
    ...initial,
    decision_type: initial.decision_type ?? (initial.decision?.trim() ? "Other" : null),
  }));
  const [step, setStep] = useState(0);
  const [spelling, setSpelling] = useState<{
    field: SpellingField; text: string;
    suggestions: { word: string; start: number; end: number; candidates: string[] }[];
  } | null>(null);
  const steps = ["Opportunity", "Decision", "Success measures", "Review"];
  const decisions = plan.improvement_area ? decisionsByArea[plan.improvement_area] : [];
  const previousDecision = plan.decision_type && plan.decision_type !== "Other"
    && !decisions.includes(plan.decision_type) ? plan.decision_type : null;
  const legacyNotes = (["strengths", "weaknesses", "opportunities", "threats"] as const)
    .filter((name) => plan[name]?.trim());

  function field(
    key: SpellingField,
    label: string, placeholder: string, required = false,
  ) {
    const value = key === "steps" ? plan.steps.join("\n") : plan[key] ?? "";
    function setField(next: string, change?: { original: string; corrected: string }) {
      setPlan((previous) => {
        const spelling_changes = change
          ? [...(previous.spelling_changes ?? []), { field: key, ...change }]
          : previous.spelling_changes ?? [];
        return key === "steps"
          ? { ...previous, steps: next.split("\n"), spelling_changes }
          : { ...previous, [key]: next, spelling_changes };
      });
    }
    return <div className="stack">
      <label>{label}
        <textarea rows={3} maxLength={4000} required={required} placeholder={placeholder} value={value}
          onChange={(event) => {
            const input = event.target;
            if (required) input.setCustomValidity(input.value && !input.value.trim() ? "Enter a value for this field." : "");
            setField(input.value);
            setSpelling(null);
          }} />
      </label>
      <button type="button" className="quiet" disabled={busy || !value.trim()} onClick={() => run(async (signal) => {
        const result = await request<{ suggestions: { word: string; start: number; end: number; candidates: string[] }[] }>(
          path + "/spelling", { ...json("POST", { text: value }), signal },
        );
        setSpelling({ field: key, text: value, suggestions: result.suggestions });
      }, "Checking English spelling locally…")}>Check spelling</button>
      {spelling?.field === key && spelling.text === value && <div className="subpanel stack" aria-live="polite">
        {spelling.suggestions.length === 0 && <p>No suggestions found.</p>}
        {spelling.suggestions.map((item) => <div key={item.start}>
          <del>{item.word}</del>{" · "}
          {item.candidates.map((candidate) => <button type="button" className="quiet" key={candidate}
            disabled={busy || (plan.spelling_changes?.length ?? 0) >= 100} onClick={() => {
              const chars = Array.from(value);
              if (chars.slice(item.start, item.end).join("") !== item.word) return;
              const updated = [...chars.slice(0, item.start), candidate, ...chars.slice(item.end)].join("");
              setField(updated, { original: item.word, corrected: candidate });
              setSpelling(null);
            }}>{candidate}</button>)}
        </div>)}
        {spelling.suggestions.length > 0 && <small>{(plan.spelling_changes?.length ?? 0) >= 100
          ? "This plan has reached the limit of 100 recorded corrections."
          : "Select a correction, then check again for other suggestions."}</small>}
      </div>}
    </div>;
  }

  function savePlan(nextStep?: number) {
    run(async (signal) => {
      const payload = { ...plan, decision: plan.decision_type === "Other" ? plan.decision : "" };
      const saved = await request<Plan>(path + "/plan", { ...json("PUT", payload), signal });
      save(saved);
      if (nextStep !== undefined) setStep(nextStep);
    }, "Saving your plan…");
  }

  const decision = plan.decision_type === "Other" || !plan.decision_type
    ? plan.decision : plan.decision_type;

  return <article className="card stack plan-wizard">
    <div>
      <h2>Shape your project</h2>
      <p>Start with the business problem. Build the plan as you learn.</p>
    </div>
    <ol className="plan-progress" aria-label="Project planning steps">
      {steps.map((name, index) => <li key={name} aria-current={index === step ? "step" : undefined}>
        <span>{index + 1}</span>{name}
      </li>)}
    </ol>
    <div className="plan-layout">
      <div className="stack">
        <form className="stack" onSubmit={(event) => {
          event.preventDefault();
          savePlan(step < 3 ? step + 1 : undefined);
        }}>
          {step === 0 && <section className="stack">
            <div><h3>What would you like to improve?</h3>
              <p>Describe the work and the outcome you want. You can refine this later.</p></div>
            <label>Improvement area *
              <select required value={plan.improvement_area ?? ""} onChange={(event) => {
                const area = event.target.value as ImprovementArea;
                setPlan((previous) => ({ ...previous, improvement_area: area,
                  decision_type: previous.decision_type === "Other" ? "Other" : null }));
              }}>
                <option value="" disabled>Select an improvement area</option>
                {improvementAreas.map((area) => <option key={area}>{area}</option>)}
              </select>
            </label>
            {field("objective", "Business goal *", "What outcome would you like to improve?", true)}
            {field("current_process", "How is this handled today? *", "Who does the work today? Where do delays or missed opportunities occur?", true)}
            <small>* Required</small>
          </section>}
          {step === 1 && <section className="stack">
            <div><h3>What action will this support?</h3>
              <p>Choose a decision your team would like to improve.</p></div>
            <label>Decision or action to improve
              <select value={plan.decision_type ?? ""}
                onChange={(event) => setPlan({ ...plan, decision_type: event.target.value || null })}>
                <option value="">Select a decision or action</option>
                {previousDecision && <option value={previousDecision}>{previousDecision} (previously saved)</option>}
                {decisions.map((item) => <option key={item}>{item}</option>)}
                <option value="Other">Other (specify)</option>
              </select>
            </label>
            {plan.decision_type === "Other" &&
              field("decision", "Describe the decision or action *", "Describe the choice and when it is made.", true)}
            {field("constraints", "Constraints and trade-offs", "Consider staffing, budget, available data, and what must stay reliable.")}
          </section>}
          {step === 2 && <section className="stack">
            <div><h3>How will you know it worked?</h3>
              <p>Choose a measure. You can fill in the baseline and target when you have them.</p></div>
            {field("success_metric", "Success metric", "For example, conversion rate or median review time.")}
            {field("current_baseline", "Current baseline", "Current performance, or how you will measure it.")}
            {field("target_outcome", "Target and timeframe", "What would success look like, and by when?")}
            <details className="subpanel">
              <summary>Data size and timing (optional)</summary>
              <div className="stack">
                {field("data_size", "Rough amount of historical data", "For example, about 10,000 leads, or not sure yet.")}
                {field("results_timing", "When are results needed?", "For example, each morning or soon after a new lead arrives.")}
              </div>
            </details>
            <details className="subpanel">
              <summary>Evaluation and next steps (optional)</summary>
              <div className="stack">
                {field("evaluation", "How to evaluate", "How will you compare the change with the current process?")}
                {field("explanation", "Why this approach", "Explain how the change might improve the decision.")}
                {field("steps", "Next steps, one per line", "List a practical next step on each line.")}
              </div>
            </details>
          </section>}
          {step === 3 && <section className="stack">
            <div><h3>Your project at a glance</h3>
              <p>Check the details with your team before moving on to data.</p></div>
            <dl className="plan-review">
              <div><dt>Improvement area</dt><dd>{plan.improvement_area}</dd></div>
              <div><dt>Business goal</dt><dd className="preserve">{plan.objective}</dd></div>
              <div><dt>Current process</dt><dd className="preserve">{plan.current_process}</dd></div>
              <div><dt>Decision</dt><dd className="preserve">{decision || "To be confirmed"}</dd></div>
              <div><dt>Success metric</dt><dd className="preserve">{plan.success_metric || "To be confirmed"}</dd></div>
              <div><dt>Baseline and target</dt><dd className="preserve">{plan.current_baseline || "Baseline to be confirmed"} · {plan.target_outcome || "Target to be confirmed"}</dd></div>
              <div><dt>Data size and timing</dt><dd className="preserve">{plan.data_size || "Size to be confirmed"} · {plan.results_timing || "Timing to be confirmed"}</dd></div>
            </dl>
            {legacyNotes.length > 0 && <details>
              <summary>Previous planning notes</summary>
              <dl>{legacyNotes.map((name) => <div key={name}>
                <dt>{name[0].toUpperCase() + name.slice(1)}</dt><dd className="preserve">{plan[name]}</dd>
              </div>)}</dl>
            </details>}
          </section>}
          <div className="actions">
            {step > 0 && <button type="button" className="quiet" disabled={busy}
              onClick={() => setStep(step - 1)}>← Back to {steps[step - 1].toLowerCase()}</button>}
            <button type="submit" disabled={busy}>{step < 3 ? "Save and continue →" : "Save plan"}</button>
            {step === 3 && <button type="button" className="quiet" disabled={busy} onClick={exportFile}>Export saved plan</button>}
          </div>
        </form>
      </div>
      <aside className="subpanel stack plan-companion" aria-label="Planning companion">
        <h3>Planning companion</h3>
        {step === 0 && <p>Describe an outcome your team wants to improve. If you know how the work happens today, include that too.</p>}
        {step === 1 && <p>Think about a choice someone makes regularly and what they could do differently.</p>}
        {step === 2 && <p>Start with one measure. If the baseline is unknown, describe how you could find it.</p>}
        {step === 3 && <p>Confirm the decision and how to measure it with the people who will use the result.</p>}
        <SuggestionPanel<Partial<Plan>> path={path} request={request} run={run} busy={busy} kind="plan"
          onSuggestion={(suggestion) => setPlan((previous) => {
            const next = { ...previous };
            for (const key of ["objective", "current_process", "success_metric",
              "current_baseline", "target_outcome", "constraints", "explanation", "evaluation"] as const) {
              if (!previous[key]?.trim() && suggestion[key]) next[key] = suggestion[key];
            }
            if ((!previous.decision_type || previous.decision_type === "Other")
              && !previous.decision?.trim() && suggestion.decision?.trim()) {
              next.decision_type = "Other";
              next.decision = suggestion.decision;
            }
            if (!previous.steps.some((item) => item.trim()) && suggestion.steps) next.steps = suggestion.steps;
            return next;
          })} />
      </aside>
    </div>
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
  if (!analysis) return <article className="card stack"><h2 className="icon-heading"><WorkspaceMark kind="evaluation" />Baseline results</h2><p>Run a baseline from Features to compare models here.</p></article>;
  return <article className="card stack"><h2 className="icon-heading"><WorkspaceMark kind="evaluation" />Baseline results</h2>
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
