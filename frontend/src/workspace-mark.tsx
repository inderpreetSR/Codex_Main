const marks = {
  pipeline: (
    <>
      <rect x="3" y="18" width="11" height="12" rx="2" />
      <path d="M14 24h5m10 0h5" />
      <circle cx="24" cy="24" r="5" />
      <rect className="workspace-mark-accent" x="34" y="18" width="11" height="12" rx="2" />
      <path className="workspace-mark-accent" d="m37 24 2 2 3-4" />
    </>
  ),
  learning: (
    <>
      <path d="M8 36h10V24h11V12h11" />
      <circle cx="8" cy="36" r="3" />
      <circle cx="18" cy="24" r="3" />
      <circle cx="29" cy="12" r="3" />
      <path className="workspace-mark-accent" d="M40 7v10m-5-5h10" />
    </>
  ),
  features: (
    <>
      <rect x="5" y="8" width="38" height="32" rx="6" />
      <path d="M5 19h38M18 8v32M30 8v32" />
      <path className="workspace-mark-accent" d="M24 24v10M36 24v10" />
    </>
  ),
  model: (
    <>
      <path d="M5 17 24 7l19 10-19 10zM5 25l19 10 19-10M5 33l19 10 19-10" />
      <path className="workspace-mark-accent" d="M16 17l8-4 8 4-8 4z" />
    </>
  ),
  evaluation: (
    <>
      <path d="M6 40h37M12 40V26h7v14M25 40V15h7v25" />
      <path className="workspace-mark-accent" d="M7 21h36m-5-4 5 4-5 4" />
    </>
  ),
};

export function WorkspaceMark({ kind }: { kind: keyof typeof marks }) {
  return (
    <svg
      className="workspace-mark"
      data-mark={kind}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {marks[kind]}
    </svg>
  );
}
