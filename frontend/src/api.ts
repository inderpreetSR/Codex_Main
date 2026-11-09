export const apiBase = "http://127.0.0.1:8000/api/v1";

export type Task = "classification" | "regression";
export type Guide = { id: string; title: string; description: string; task: Task | null; sections: Record<string, string> };
export type Plan = {
  objective: string; explanation: string; steps: string[]; evaluation: string;
  strengths: string; weaknesses: string; opportunities: string; threats: string;
};
export type Column = { name: string; kind: "numeric" | "categorical" };
export type Transform = {
  name: string; operation: "missing" | "log" | "ratio" | "encode"; source: string; denominator: string | null;
};
export type Features = {
  manual: Column[]; target: string | null; available: string[]; selected: string[]; transforms: Transform[];
};
export type Project = {
  id: string; title: string; description: string; task: Task; plan: Plan; features: Features; share_private: boolean;
};
export type Profile = { rows: number; columns: (Column & { missing: number; unique: number; score: number; warnings: string[] })[] };
export type Upload = { id: string; name: string; kind: "csv" | "document"; status: string; profile: Profile | null };
export type Job<T> = { id: string; status: "queued" | "running" | "succeeded" | "failed"; result: T | null; error: string | null };
export type Config = { domain: string; clientId: string; audience: string };

export async function get<T>(path: string, options: RequestInit = {}, token?: string, session?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", "Bearer " + token);
  if (session) headers.set("X-Workspace-Session", session);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(apiBase + path, { ...options, headers, credentials: "omit" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : "Request failed (" + response.status + ").");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type Request = <T>(path: string, options?: RequestInit) => Promise<T>;

export function json(method: "POST" | "PUT", value: unknown): RequestInit {
  return { method, body: JSON.stringify(value) };
}

export async function poll<T>(request: Request, jobId: string, signal: AbortSignal): Promise<T> {
  for (let count = 0; count < 360 && !signal.aborted; count++) {
    const job = await request<Job<T>>("/jobs/" + jobId, { signal });
    if (job.status === "failed") throw new Error(job.error ?? "Processing failed.");
    if (job.status === "succeeded" && job.result !== null) return job.result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  throw new Error("The job is still pending. Job ID " + jobId);
}

export async function download(projectId: string, kind: "plan" | "features", token: string, session: string) {
  const response = await fetch(apiBase + "/projects/" + projectId + "/exports/" + kind, {
    headers: { Authorization: "Bearer " + token, "X-Workspace-Session": session }, credentials: "omit",
  });
  if (!response.ok) throw new Error("Export failed (" + response.status + ").");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = kind === "plan" ? "plan.md" : "features.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
