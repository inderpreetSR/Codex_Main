import { useState } from "react";
import { json, poll, type Column, type Features, type Profile, type Project, type Request, type Transform, type Upload } from "./api";
import { SuggestionPanel, UploadPanel } from "./panels";

export type Analysis = {
  training_rows: number; holdout_rows: number; excluded_missing_targets: number;
  metrics: Record<string, Record<string, number>>;
  importance: { feature: string; mean: number; std: number }[];
};
type Preview = { columns: string[]; rows: unknown[][]; encodings: Record<string, { categories: string[]; rows: number[][] }> };
type FeatureProps = {
  project: Project; uploads: Upload[]; request: Request; path: string; busy: boolean;
  run: (operation: (signal: AbortSignal) => Promise<void>, working?: string) => void;
  save: (features: Features) => void; upload: (file: File) => void; remove: (file: Upload) => void;
  exportFile: () => void; onBaseline: (result: Analysis) => void;
};
const operations: [Transform["operation"], string][] = [
  ["missing", "Missing-value flag"], ["log", "Log(1 + x)"], ["ratio", "Ratio"], ["encode", "Category encoding"],
];

function toggle(values: string[], value: string, checked: boolean) {
  return checked ? [...values, value] : values.filter((item) => item !== value);
}

export function FeaturesPanel({ project, uploads, request, path, busy, run, save, upload, remove, exportFile, onBaseline }: FeatureProps) {
  const [spec, setSpec] = useState(project.features);
  const [selectedUpload, setSelectedUpload] = useState<string | null>(null);
  const [columnName, setColumnName] = useState("");
  const [columnKind, setColumnKind] = useState<Column["kind"]>("numeric");
  const [transform, setTransform] = useState<Transform>({ name: "", operation: "missing", source: "", denominator: null });
  const [independent, setIndependent] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const ready = uploads.filter((file) => file.status === "succeeded" && file.profile);
  const dataset = selectedUpload === "manual" ? undefined
    : ready.find((file) => file.id === selectedUpload) ?? ready[0];
  const columns: (Column | Profile["columns"][number])[] = dataset?.profile?.columns ?? spec.manual;
  const columnNames = columns.map((column) => column.name);
  const available = spec.available.filter((name) => columnNames.includes(name));
  const manual = !dataset;

  function dropColumn(name: string, next: Features): Features {
    return { ...next, available: next.available.filter((item) => item !== name),
      selected: next.selected.filter((item) => item !== name),
      transforms: next.transforms.filter((item) => item.source !== name && item.denominator !== name) };
  }

  function saveSpec(signal: AbortSignal) {
    return request<Features>(path + "/features", { ...json("PUT", spec), signal }).then(save);
  }

  function analyze(mode: "preview" | "baseline") {
    if (!dataset) return;
    run(async (signal) => {
      await saveSpec(signal);
      const queued = await request<{ job_id: string }>(path + "/analysis/" + mode, {
        ...json("POST", { upload_id: dataset.id, independent_rows: independent }), signal,
      });
      if (mode === "preview") setPreview(await poll<Preview>(request, queued.job_id, signal));
      else onBaseline(await poll<Analysis>(request, queued.job_id, signal));
    }, mode === "preview" ? "Building preview…" : "Fitting and evaluating baseline models…");
  }

  return <article className="card stack"><h2>Feature Selector and Builder</h2>
    <UploadPanel uploads={uploads} upload={upload} remove={remove} busy={busy} type="csv" />
    <label>Column source<select value={dataset?.id ?? "manual"} onChange={(event) => {
      setSelectedUpload(event.target.value); setPreview(null);
    }}><option value="manual">Manual columns</option>{ready.map((file) =>
      <option value={file.id} key={file.id}>{file.name}</option>)}</select></label>
    {manual && <div className="actions">
      <label>Column name<input value={columnName} maxLength={120} onChange={(event) => setColumnName(event.target.value)} /></label>
      <label>Type<select value={columnKind} onChange={(event) => setColumnKind(event.target.value as Column["kind"])}>
        <option value="numeric">Numeric</option><option value="categorical">Categorical</option>
      </select></label>
      <button className="quiet" disabled={!columnName.trim() || columnNames.includes(columnName.trim()) || columnNames.length >= 100}
        onClick={() => { setSpec({ ...spec, manual: [...spec.manual, { name: columnName.trim(), kind: columnKind }] }); setColumnName(""); }}>
        Add column</button>
    </div>}
    {columns.length > 0 && <>
      <label>Target column<select value={columnNames.includes(spec.target ?? "") ? spec.target ?? "" : ""}
        onChange={(event) => {
          const name = event.target.value;
          setSpec(dropColumn(name, { ...spec, target: name || null }));
        }}><option value="">Choose target</option>{columns.map((column) =>
          <option key={column.name} value={column.name}>{column.name}</option>)}</select></label>
      <div className="table-scroll"><table><thead><tr><th>Column</th><th>Type</th><th>Profile</th>
        <th>Available at prediction</th><th>Selected</th>{manual && <th>Action</th>}</tr></thead><tbody>
        {columns.map((column) => <tr key={column.name}><td>{column.name}</td><td>{column.kind}</td>
          <td>{"score" in column ? <>Score {String(column.score)} · {String(column.missing)} missing · {String(column.unique)} distinct
            {column.warnings.map((warning) => <small className="warning" key={warning}>{warning}</small>)}</> : "Manual"}</td>
          <td><input type="checkbox" aria-label={column.name + " available at prediction"} checked={spec.available.includes(column.name)}
            disabled={spec.target === column.name} onChange={(event) => setSpec(event.target.checked
              ? { ...spec, available: toggle(spec.available, column.name, true) } : dropColumn(column.name, spec))} /></td>
          <td><input type="checkbox" aria-label={column.name + " selected"} checked={spec.selected.includes(column.name)}
            disabled={!spec.available.includes(column.name)} onChange={(event) => setSpec({
              ...spec, selected: toggle(spec.selected, column.name, event.target.checked),
            })} /></td>
          {manual && <td><button className="quiet" onClick={() => setSpec(dropColumn(column.name, {
            ...spec, target: spec.target === column.name ? null : spec.target,
            manual: spec.manual.filter((item) => item.name !== column.name),
          }))}>Remove</button></td>}
        </tr>)}
      </tbody></table></div>
    </>}
    <div className="subpanel stack"><h3>Build a feature</h3>
      <div className="form-grid">
        <label>Derived name<input value={transform.name} maxLength={120}
          onChange={(event) => setTransform({ ...transform, name: event.target.value })} /></label>
        <label>Operation<select value={transform.operation} onChange={(event) => setTransform({
          ...transform, operation: event.target.value as Transform["operation"], denominator: null,
        })}>{operations.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Input<select value={transform.source} onChange={(event) => setTransform({ ...transform, source: event.target.value })}>
          <option value="">Choose input</option>{available.map((name) => <option key={name}>{name}</option>)}
        </select></label>
        {transform.operation === "ratio" && <label>Denominator<select value={transform.denominator ?? ""}
          onChange={(event) => setTransform({ ...transform, denominator: event.target.value || null })}>
          <option value="">Choose input</option>{available.map((name) => <option key={name}>{name}</option>)}</select></label>}
      </div>
      <button className="quiet" disabled={!transform.name.trim() || columnNames.includes(transform.name.trim())
        || spec.transforms.some((item) => item.name === transform.name.trim())
        || !available.includes(transform.source)
        || (transform.operation === "ratio" && !available.includes(transform.denominator ?? ""))
        || spec.transforms.length >= 30}
        onClick={() => { setSpec({ ...spec, transforms: [...spec.transforms, { ...transform, name: transform.name.trim() }] });
          setTransform({ ...transform, name: "" }); }}>Add transformation</button>
      {spec.transforms.map((item) => <div className="file-row" key={item.name}>
        <span>{item.name} · {item.operation} ({item.source}{item.denominator ? ", " + item.denominator : ""})</span>
        <button className="quiet" onClick={() => setSpec({
          ...spec, transforms: spec.transforms.filter((candidate) => candidate.name !== item.name),
        })}>Remove</button>
      </div>)}
    </div>
    <div className="actions"><button disabled={busy} onClick={() => run(async (signal) => { await saveSpec(signal); })}>Save feature spec</button>
      <button className="quiet" disabled={busy} onClick={exportFile}>Export saved feature spec</button>
      <button className="quiet" disabled={busy || !dataset} onClick={() => analyze("preview")}>Preview transformations</button></div>
    {preview && <section className="subpanel stack"><h3>Local transformation preview</h3>
      <div className="table-scroll"><table><thead><tr>{preview.columns.map((name) => <th key={name}>{name}</th>)}</tr></thead>
        <tbody>{preview.rows.map((row, index) => <tr key={index}>{row.map((value, column) =>
          <td key={preview.columns[column]}>{value == null ? "—" : String(value)}</td>)}</tr>)}</tbody></table></div>
      {Object.entries(preview.encodings).map(([name, encoding]) => <details key={name}>
        <summary>{name} one-hot preview</summary><p>Categories shown here come from the preview rows. Training learns categories from training data.</p>
        <pre>{JSON.stringify(encoding, null, 2)}</pre></details>)}
    </section>}
    <div className="subpanel stack"><h3>Baseline model</h3>
      <label className="checkbox"><input type="checkbox" checked={independent}
        onChange={(event) => setIndependent(event.target.checked)} />Rows are independent. A random holdout is appropriate.</label>
      <button disabled={busy || !dataset || !independent || !spec.target} onClick={() => analyze("baseline")}>Run baseline comparison</button>
    </div>
    <SuggestionPanel<{ suggestions: string[] }> path={path} request={request} run={run} busy={busy} kind="features"
      onSuggestion={(value) => setSuggestions(value.suggestions)} />
    {suggestions.length > 0 && <ul>{suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul>}
  </article>;
}
