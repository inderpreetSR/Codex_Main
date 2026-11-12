# First-phase test cases

This checklist covers the local Codex_Main workspace. Use synthetic data and the
isolated Compose test database. The live Auth0 and OpenRouter checks use separate,
explicitly approved requests. A test is not passed until its result is recorded.

| ID | Area | Action | Expected result | Current verification |
|---|---|---|---|---|
| P1-01 | Site | Open the frontend and API health endpoint | Both respond on their configured local ports | Manual |
| P1-02 | Authentication | Sign in and out; try an invalid or expired token | Valid account enters; invalid token and ended session are rejected | Automated fixture; live Auth0 separate |
| P1-03 | Ownership | Two users request each other's project, upload, job, and export | Access is denied | Automated fixture |
| P1-04 | CORS | Send preflight requests from allowed and different origins | Only the configured frontend origin is allowed | Automated |
| P1-05 | Plan | Complete opportunity, decision, measures and review; reopen and export | Saved fields persist and Markdown matches | API automated; browser flow manual |
| P1-06 | Required fields | Omit the improvement area, goal, or current process | Save shows a useful validation error | API automated; browser flow manual |
| P1-07 | Spelling | Check synthetic misspellings, accept a correction, save and export | User selects corrections; Markdown shows accepted correction history | API automated; selection flow manual |
| P1-08 | Features | Describe columns and mark target and prediction-time inputs | Eligible features can be saved; target and leakage are excluded | Manual feature save covered; leakage checks pending |
| P1-09 | Upload limits | Upload UTF-8 CSVs at and beyond supported size and shape limits | Valid files process; oversized or malformed files are rejected | Partial coverage; boundary cases pending |
| P1-10 | Baselines | Run classification and regression twice on synthetic CSVs | Same split and metrics are reproduced; preprocessing fits on training only | Automated fixture |
| P1-11 | Jobs | Interrupt a claimed job and allow its lease to expire | A worker reclaims it; another account cannot read the result | Automated fixture |
| P1-12 | RAG search | Index a synthetic document, search a paraphrase, and delete it | Authorized search finds its source; deletion removes it | Automated, real local embeddings and PostgreSQL |
| P1-13 | RAG privacy | Search as another account; try private sharing off, on, and revoked | Private excerpts appear only for the owner and according to current consent | Automated, mocked provider |
| P1-14 | Prompt injection | Include instructions in a synthetic document | Text cannot trigger tools; citations must refer to retrieved sources | Partial automated coverage; no live model test |
| P1-15 | AI planning | Review summary; change it; submit old approval | Stale approval is rejected and no request is dispatched | Wrong digest tested; changed-summary case pending |
| P1-16 | AI fallback | Simulate primary failure and successful fallback | Result is returned and both use identical privacy routing | Automated mocked provider |
| P1-17 | Live AI | Approve one synthetic request from the app | Generation completes; timing, cost and failure states are understandable | Pending; previous structured request stalled |
| P1-18 | Responsive UI | Complete plan on desktop and mobile with keyboard | Inputs, focus, navigation and validation remain usable | Manual; pending |
| P1-19 | Isolation | Inspect worker mounts, network and environment | No developer credentials, Docker socket or external egress in offline worker | Manual; pending |

## LangGraph test cases — planned

The repository currently has LangChain-based retrieval and job processing, but
no LangGraph dependency or graph implementation. These cases are acceptance
criteria for a future graph, not passing or skipped automated tests.

| ID | Scenario | Expected result |
|---|---|---|
| LG-01 | Route a business question with insufficient context | Graph asks a focused clarification and does not invent missing facts. |
| LG-02 | Compare analysis, dashboard, statistical evaluation and ML | Recommendation includes rationale, uncertainties and user override. |
| LG-03 | Retrieve from two accounts and projects | Only authorized sources are accessible and citations match retrieved excerpts. |
| LG-04 | Consent off, enabled, then revoked while a job waits | Private excerpts are absent before consent and after revocation. |
| LG-05 | Malicious instructions in a source document | Source text cannot invoke tools, change routing or override instructions. |
| LG-06 | Interrupt at an approval or checkpoint and resume | Resume uses the correct project and state without duplicate external calls. |
| LG-07 | Provider timeout, rate limit, malformed output or invalid citation | Bounded failure or eligible fallback, with privacy controls maintained. |
| LG-08 | Concurrent projects and repeated execution | State remains isolated and side effects are idempotent. |

## Recording results

Record date, commit or local revision, environment, test ID, pass/fail/blocked,
and evidence without keys, tokens, customer data or raw private documents.



## Local check on 2026-11-12

The isolated Docker verification suite completed with **12 passed**. It used
synthetic data, a disposable PostgreSQL database, local embedding weights,
fixture Auth0 tokens, and a mocked OpenRouter provider. The temporary test
containers and volumes were removed after the run.

Live Auth0, the real OpenRouter generation path, the signed-in browser flow,
worker isolation, and the planned LangGraph cases were not verified by this run.
