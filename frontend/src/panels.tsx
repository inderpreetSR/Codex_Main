import { useState } from "react";
import { json, poll, type Request, type Upload } from "./api";

export type Runner = (operation: (signal: AbortSignal) => Promise<void>, working?: string) => void;
export type PanelProps = { path: string; request: Request; run: Runner; busy: boolean };
type Suggestion = { payload: unknown; digest: string };

export function SuggestionPanel<T>({ path, request, run, busy, kind, onSuggestion }: PanelProps & {
  kind: "plan" | "features"; onSuggestion: (result: T) => void;
}) {
  const [summary, setSummary] = useState<Suggestion | null>(null);
  return <div className="subpanel stack">
    <h3>AI suggestions</h3><p>Review the data that will be sent to OpenRouter.</p>
    {summary ? <>
      <pre>{JSON.stringify(summary.payload, null, 2)}</pre>
      <div className="actions"><button disabled={busy} onClick={() => run(async (signal) => {
        const task = await request<{ job_id: string }>(path + "/ai/" + kind, { ...json("POST", { digest: summary.digest }), signal });
        setSummary(null);
        onSuggestion(await poll<T>(request, task.job_id, signal));
      }, "Generating suggestions…")}>Approve and generate</button>
      <button className="quiet" disabled={busy} onClick={() => setSummary(null)}>Cancel</button></div>
    </> : <button className="quiet" disabled={busy} onClick={() => run(async (signal) => {
      setSummary(await request<Suggestion>(path + "/ai/summary", { signal }));
    })}>Review outgoing data</button>}
  </div>;
}

export function UploadPanel({ uploads, upload, remove, busy, type }: {
  uploads: Upload[]; upload: (file: File) => void; remove: (file: Upload) => void; busy: boolean; type: "csv" | "document";
}) {
  return <div className="subpanel stack">
    <label>{type === "csv" ? "Upload a CSV" : "Upload a reference document"}
      <input type="file" accept={type === "csv" ? ".csv" : ".pdf,.md,.txt"} disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]; if (file) upload(file); event.target.value = "";
        }} />
    </label>
    {uploads.map((file) => <div className="file-row" key={file.id}>
      <span>{file.name} <small>{file.status}</small></span>
      <button className="quiet" disabled={busy} onClick={() => remove(file)}>Delete</button>
    </div>)}
  </div>;
}
