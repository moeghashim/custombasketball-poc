// steppers.jsx — three "process completes step by step" animations.
// Each is a self-contained React component that auto-plays once on mount and
// exposes a Replay control. Exported to window for the host page to mount.

const STEPS = [
  { title: 'Connect repository', meta: 'Linked github.com/acme/web' },
  { title: 'Install dependencies', meta: '248 packages · 6.4s' },
  { title: 'Run build', meta: 'Compiled 1,204 modules' },
  { title: 'Deploy to production', meta: 'Live at acme.app' },
];

// ── shared sequencing hook ───────────────────────────────────────────────
// completed = number of fully-finished steps. active = the one in progress.
// Auto-plays once on mount; returns a replay() to run it again.
function useSequence(count, { stepMs = 1100, startDelay = 500 } = {}) {
  const [done, setDone] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const timers = React.useRef([]);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const run = React.useCallback(() => {
    clear();
    setDone(0);
    setRunning(true);
    for (let i = 1; i <= count; i++) {
      timers.current.push(setTimeout(() => {
        setDone(i);
        if (i === count) setRunning(false);
      }, startDelay + i * stepMs));
    }
  }, [count, stepMs, startDelay]);

  React.useEffect(() => { run(); return clear; }, [run]);

  return { done, running, replay: run, active: running ? done : -1 };
}

// status for a given index: 'done' | 'active' | 'todo'
const statusOf = (i, done) => (i < done ? 'done' : i === done ? 'active' : 'todo');

// ── drawn-in check (SVG stroke) ──────────────────────────────────────────
function DrawCheck({ size = 20, color = '#fff', stroke = 2.4, on }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         style={{ display: 'block' }}>
      <path d="M5 12.8 L10 17.5 L19 7"
            stroke={color} strokeWidth={stroke}
            strokeLinecap="round" strokeLinejoin="round"
            style={{
              strokeDasharray: 28,
              strokeDashoffset: on ? 0 : 28,
              transition: 'stroke-dashoffset .42s cubic-bezier(.65,0,.35,1) .05s',
            }} />
    </svg>
  );
}

function ReplayBtn({ onClick, style }) {
  return (
    <button onClick={onClick} className="rp-btn" style={style}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M5 3.5V8h4.5"
              stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Replay
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   VARIATION A — Minimal mono. Horizontal rail, hairline connectors that
   fill ink as you advance, checkmark draws in. Pure graphite + whitespace.
   ════════════════════════════════════════════════════════════════════════ */
function StepperA() {
  const { done, replay, active } = useSequence(STEPS.length, { stepMs: 1050 });
  return (
    <div className="vA">
      <div className="vA-head">
        <span className="vA-eyebrow">How it works</span>
        <h3 className="vA-title">From commit to live in four steps</h3>
      </div>

      <div className="vA-rail">
        {STEPS.map((s, i) => {
          const st = statusOf(i, done);
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <div className="vA-conn">
                  <div className="vA-conn-fill" style={{ transform: `scaleX(${i <= done ? 1 : 0})` }} />
                </div>
              )}
              <div className={`vA-step is-${st}`}>
                <div className="vA-node">
                  <span className="vA-num" style={{ opacity: st === 'done' ? 0 : 1 }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="vA-check"><DrawCheck color="#fff" on={st === 'done'} /></span>
                  {st === 'active' && <span className="vA-ring" />}
                </div>
                <div className="vA-label">
                  <div className="vA-step-title">{s.title}</div>
                  <div className="vA-step-meta">{s.meta}</div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="vA-foot">
        <span className="vA-count">{done} / {STEPS.length} complete</span>
        <ReplayBtn onClick={replay} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   VARIATION B — Soft accent. Vertical-feel horizontal cards on a tinted
   surface; node FILLS with green on completion, connector floods, label
   color shifts. Friendlier, rounded.
   ════════════════════════════════════════════════════════════════════════ */
function StepperB() {
  const { done, replay } = useSequence(STEPS.length, { stepMs: 1050 });
  return (
    <div className="vB">
      <div className="vB-head">
        <span className="vB-eyebrow">● Setup</span>
        <h3 className="vB-title">Your project goes live automatically</h3>
      </div>

      <div className="vB-rail">
        {STEPS.map((s, i) => {
          const st = statusOf(i, done);
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <div className="vB-conn">
                  <div className="vB-conn-fill" style={{ transform: `scaleX(${i <= done ? 1 : 0})` }} />
                </div>
              )}
              <div className={`vB-step is-${st}`}>
                <div className="vB-node">
                  <span className="vB-check"><DrawCheck color="#fff" stroke={2.6} on={st === 'done'} /></span>
                  <span className="vB-dot" style={{ opacity: st === 'todo' ? 1 : 0 }} />
                </div>
                <div className="vB-step-title">{s.title}</div>
                <div className="vB-step-meta">{s.meta}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="vB-foot">
        <span className="vB-count"><span className="vB-pulse" />{done === STEPS.length ? 'All set — deployment complete' : 'Working…'}</span>
        <ReplayBtn onClick={replay} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   VARIATION C — Card stack. Each step is a row card; on completion it pulses
   then settles, a check badge pops, the row lifts and a subtle accent edge
   appears. More "task list" / product feel.
   ════════════════════════════════════════════════════════════════════════ */
function StepperC() {
  const { done, replay } = useSequence(STEPS.length, { stepMs: 1050 });
  return (
    <div className="vC">
      <div className="vC-head">
        <h3 className="vC-title">Deploying your app</h3>
        <span className="vC-count">{done}/{STEPS.length}</span>
      </div>

      <div className="vC-bar"><div className="vC-bar-fill" style={{ width: `${(done / STEPS.length) * 100}%` }} /></div>

      <div className="vC-list">
        {STEPS.map((s, i) => {
          const st = statusOf(i, done);
          return (
            <div key={i} className={`vC-row is-${st}`}>
              <div className="vC-badge">
                <span className="vC-spin" />
                <span className="vC-check"><DrawCheck color="#fff" on={st === 'done'} /></span>
                <span className="vC-idle" />
              </div>
              <div className="vC-text">
                <div className="vC-row-title">{s.title}</div>
                <div className="vC-row-meta">{st === 'active' ? 'In progress…' : s.meta}</div>
              </div>
              <span className="vC-state">{st === 'done' ? 'Done' : st === 'active' ? '···' : ''}</span>
            </div>
          );
        })}
      </div>

      <div className="vC-foot">
        <ReplayBtn onClick={replay} />
      </div>
    </div>
  );
}

Object.assign(window, { StepperA, StepperB, StepperC });
