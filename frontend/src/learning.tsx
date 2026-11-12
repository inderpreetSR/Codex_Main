import { WorkspaceMark } from "./workspace-mark";
import { useEffect, useRef, useState } from "react";
import type { Guide } from "./api";

export function LearningJourney({ guide, close, start, signIn }: {
  guide: Guide; close: () => void; start?: (guide: Guide) => void; signIn?: React.ReactNode;
}) {
  const sections = Object.entries(guide.sections);
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const current = sections[step];
  return <section className="learning-journey" aria-labelledby="journey-title">
    <button className="quiet back" onClick={close}>← Back to learning hub</button>
    <div className="section-title journey-heading"><span className="eyebrow">LEARNING JOURNEY · {guide.title}</span><h1 id="journey-title">Understand the question.</h1><p>{guide.description}</p></div>
    <div className="journey-grid">
      <nav className="card journey-path" aria-label="Guide sections"><span className="eyebrow icon-heading"><WorkspaceMark kind="learning" />Your learning path</span><p>Step {step + 1} of {sections.length}</p><ol>{sections.map(([title], index) =>
        <li key={title}><button type="button" className={index === step ? "journey-step active" : "journey-step"} aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)}><span className="step-number">{index + 1}</span>{title}</button></li>)}</ol></nav>
      <article className="journey-content" aria-live="polite">{current && <><span className="eyebrow">STEP {step + 1} OF {sections.length}</span><h2 ref={heading} tabIndex={-1}>{current[0]}</h2><p>{current[1]}</p></>}
        <div className="journey-tip"><strong>Think it through</strong><p>{guide.task ? "Consider what information is available when a prediction is made. A prediction alone does not explain why an outcome occurs." : "Consider the assumptions behind the approach and how you will check whether its results are useful."}</p></div>
        <div className="actions"><button type="button" className="quiet" disabled={step === 0} onClick={() => setStep(step - 1)}>Previous</button>{step < sections.length - 1 ? <button type="button" onClick={() => setStep(step + 1)}>Next section →</button> : guide.task && start ? <button type="button" onClick={() => start(guide)}>Start a project →</button> : null}</div>
        {step === sections.length - 1 && !start && guide.task && <div className="journey-signin"><p>Sign in, then choose this guide again to start a project.</p>{signIn}</div>}
      </article>
      <aside className="card journey-companion"><span className="eyebrow">LEARNING COMPANION</span><h2>Need more context?</h2><p>Use the guide sections to explore the problem, data and evaluation at your own pace.</p><p>In a project, the Knowledge section can search sources and answer questions.</p></aside>
    </div>
  </section>;
}
