// flow.jsx — shell, step list, hooks, and an event-driven controller.
// Two modes:
//   • auto  — fixed clock; each step plays for its duration (great for demos)
//   • live  — driven by window.createFlowController(flow): reveals happen
//             only when YOUR events fire (websocket / SSE / poll).
const { useState, useEffect, useRef, useCallback } = React;

/* ── timed clock (auto mode): supports per-step durations ──────────────── */
function useFlow(durations, startDelay = 500) {
  const count = durations.length;
  const [active, setActive] = useState(0);
  const [done, setDone] = useState(0);
  const timers = useRef([]);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const run = useCallback(() => {
    clear(); setActive(0); setDone(0);
    let acc = startDelay;
    for (let i = 0; i < count; i++) {
      acc += durations[i];
      const next = i + 1;
      timers.current.push(setTimeout(() => { setDone(next); setActive(next < count ? next : count); }, acc));
    }
  }, [durations.join(','), startDelay]);
  useEffect(() => { const t = setTimeout(run, 120); return () => { clearTimeout(t); clear(); }; }, [run]);
  return { active, done, replay: run };
}

// phase counter 0..n — drives staged reveals inside a stage (auto mode).
// `enabled:false` disables the internal clock (live mode supplies progress).
function useSteps(n, interval = 380, startDelay = 220, enabled = true) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    setP(0);
    const t = [];
    for (let i = 1; i <= n; i++) t.push(setTimeout(() => setP(i), startDelay + i * interval));
    return () => t.forEach(clearTimeout);
  }, [n, interval, startDelay, enabled]);
  return p;
}

// eased count-up (setInterval-based; rAF can be throttled in previews).
function useCounter(target, dur = 1300, delay = 200) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let id; const total = Math.max(1, Math.round(dur / 40)); let i = 0;
    const start = setTimeout(() => {
      id = setInterval(() => {
        i++; const k = Math.min(1, i / total);
        setV(target * (1 - Math.pow(1 - k, 3)));
        if (k >= 1) { setV(target); clearInterval(id); }
      }, 40);
    }, delay);
    return () => { clearTimeout(start); clearInterval(id); };
  }, [target, dur, delay]);
  return v;
}

function CountNum({ value, decimals = 0, prefix = '', suffix = '', dur = 1300, delay = 600 }) {
  const v = useCounter(value, dur, delay);
  return <>{prefix}{v.toFixed(decimals)}{suffix}</>;
}

/* ════════════════════════════════════════════════════════════════════════
   EVENT-DRIVEN CONTROLLER
   const c = createFlowController(FLOW);
   render(<AgentFlow flow={FLOW} controller={c} />)   // FLOW.mode must be 'live'
   Then, as real work happens, call:
     c.activate(stepId)                 mark a step in-progress
     c.complete(stepId)                 mark done; auto-advances to next
     c.pushSource(stepId, name)         stream a discovered research source
     c.pushLog(stepId, {kind,text})     append a build/terminal line
     c.addCompetitor(stepId, {...})     reveal a competitor
     c.mergeData(stepId, {signals, kpis, chart, ...})   set/replace fields
     c.progress(stepId, n) / c.bump(stepId)             reveal n pre-known items
     c.finish() / c.reset() / c.restart()
   Pass a runner to c.start(runner) to make the Replay button re-run it.
   ════════════════════════════════════════════════════════════════════════ */
function createFlowController(flow) {
  const listeners = new Set();
  const blank = () => flow.steps.map(s => ({ data: JSON.parse(JSON.stringify(s.data || {})), progress: 0 }));
  let st = { active: 0, done: 0, finished: false, steps: blank() };
  let timers = [];
  const emit = () => listeners.forEach(l => l());
  const set = (patch) => { st = { ...st, ...patch }; emit(); };
  const idxOf = (ref) => (typeof ref === 'number' ? ref : flow.steps.findIndex(s => s.id === ref));
  const editStep = (ref, fn) => {
    const i = idxOf(ref); if (i < 0) return;
    const steps = st.steps.slice(); steps[i] = fn({ ...steps[i] }); set({ steps });
  };
  const api = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getState() { return st; },
    after(ms, fn) { const id = setTimeout(fn, ms); timers.push(id); return id; },
    reset() { timers.forEach(clearTimeout); timers = []; st = { active: 0, done: 0, finished: false, steps: blank() }; emit(); },
    activate(ref) { set({ active: idxOf(ref), finished: false }); },
    complete(ref, opts = {}) {
      const advance = opts.advance !== false;
      const i = idxOf(ref); const done = Math.max(st.done, i + 1);
      set({ done, active: advance ? Math.min(i + 1, flow.steps.length) : st.active, finished: done >= flow.steps.length });
    },
    progress(ref, n) { editStep(ref, s => ({ ...s, progress: n })); },
    bump(ref, by = 1) { editStep(ref, s => ({ ...s, progress: s.progress + by })); },
    mergeData(ref, partial) { editStep(ref, s => ({ ...s, data: { ...s.data, ...partial } })); },
    pushSource(ref, src) { editStep(ref, s => { const d = { ...s.data, sources: [...(s.data.sources || []), src] }; return { ...s, data: d, progress: d.sources.length }; }); },
    pushLog(ref, log) { editStep(ref, s => { const d = { ...s.data, logs: [...(s.data.logs || []), log] }; return { ...s, data: d, progress: d.logs.length }; }); },
    addCompetitor(ref, c) { editStep(ref, s => { const d = { ...s.data, competitors: [...(s.data.competitors || []), c] }; return { ...s, data: d, progress: d.competitors.length }; }); },
    finish() { set({ done: flow.steps.length, active: flow.steps.length, finished: true }); },
    start(runner) { api._runner = runner; api.reset(); if (runner) runner(api); },
    restart() { api.reset(); if (api._runner) api._runner(api); },
  };
  return api;
}

/* ── icons / buttons ───────────────────────────────────────────────────── */
function Check({ size = 18, color = '#fff', stroke = 2.5, on = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <path d="M5 12.8 L10 17.5 L19 7" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
            style={{ strokeDasharray: 28, strokeDashoffset: on ? 0 : 28, transition: 'stroke-dashoffset .42s cubic-bezier(.65,0,.35,1) .05s' }} />
    </svg>
  );
}
function MiniCheck() {
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path d="M5 12.5 L10 17 L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
function ReplayBtn({ onClick }) {
  return (
    <button className="rp-btn" onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M5 3.5V8h4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Replay
    </button>
  );
}

/* ── step row ──────────────────────────────────────────────────────────── */
function StepRow({ index, step, status }) {
  const stateText = status === 'done' ? 'Completed' : status === 'active' ? (step.working || 'Working…') : '';
  return (
    <div className={`fstep is-${status}`}>
      <div className="badge">
        <span className="idle">{index + 1}</span>
        <span className="spin"></span>
        <span className="ck"><Check size={16} on={status === 'done'} /></span>
      </div>
      <div className="fstep-tx">
        <div className="fstep-title">{step.title}</div>
        {step.sub && <div className="fstep-sub">{step.sub}</div>}
        <div className="fstep-state">{status === 'active' && <span className="live"></span>}{stateText}</div>
      </div>
    </div>
  );
}

/* ── presentational shell (mode-agnostic) ──────────────────────────────── */
function FlowView({ flow, active, done, finished, replay, stageIndex, stageData, stageProgress, duration }) {
  const steps = flow.steps;
  const cur = steps[stageIndex];
  const Stage = (window.STAGES || {})[cur.type] || (() => <div className="stage-pad"><div className="stage-cap">Unknown stage: {cur.type}</div></div>);
  const statusOf = (i) => i < done ? 'done' : (i === active && !finished) ? 'active' : 'todo';
  return (
    <div className="card">
      <div className="top">
        <div className="top-l">
          <span className="kicker"><span className="spark"></span>{flow.kicker || 'AGENT · LIVE'}</span>
          <h1 className="title">{flow.title}</h1>
        </div>
        <div className="top-r">
          <ReplayBtn onClick={replay} />
          <span className="status">
            {finished
              ? <><b>Done</b> · {steps.length} of {steps.length} tasks complete</>
              : <>Step <b>{Math.min(active + 1, steps.length)}</b> of {steps.length}</>}
          </span>
        </div>
      </div>
      <div className="pbar"><div className="pbar-fill" style={{ width: `${(done / steps.length) * 100}%` }}></div></div>
      <div className="body">
        <div className="steps">
          {steps.map((s, i) => <StepRow key={s.id || i} index={i} step={s} status={statusOf(i)} />)}
        </div>
        <div className="stage">
          <div className="stage-root" key={stageIndex}>
            <Stage data={stageData} duration={duration} progress={stageProgress} finished={finished} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── auto mode (timed) ─────────────────────────────────────────────────── */
function AutoFlow({ flow }) {
  const steps = flow.steps;
  const defDur = flow.stepDurationMs || 4000;
  const durations = steps.map(s => s.durationMs || defDur);
  const { active, done, replay } = useFlow(durations);
  const finished = active >= steps.length;
  const stageIndex = Math.min(active, steps.length - 1);
  return <FlowView flow={flow} active={active} done={done} finished={finished} replay={replay}
                   stageIndex={stageIndex} stageData={steps[stageIndex].data || {}}
                   stageProgress={undefined} duration={durations[stageIndex]} />;
}

/* ── live mode (event-driven) ──────────────────────────────────────────── */
function LiveFlow({ flow, controller }) {
  const [, force] = useState(0);
  useEffect(() => controller.subscribe(() => force(x => x + 1)), [controller]);
  const st = controller.getState();
  const steps = flow.steps;
  const stageIndex = Math.min(st.active, steps.length - 1);
  const defDur = flow.stepDurationMs || 4000;
  return <FlowView flow={flow} active={st.active} done={st.done} finished={st.finished}
                   replay={() => controller.restart()} stageIndex={stageIndex}
                   stageData={st.steps[stageIndex].data || {}} stageProgress={st.steps[stageIndex].progress}
                   duration={steps[stageIndex].durationMs || defDur} />;
}

function AgentFlow({ flow, controller }) {
  return (flow.mode === 'live' && controller)
    ? <LiveFlow flow={flow} controller={controller} />
    : <AutoFlow flow={flow} />;
}

Object.assign(window, {
  useState, useEffect, useRef, useCallback,
  useSteps, useCounter, CountNum, Check, MiniCheck, ReplayBtn,
  createFlowController, AgentFlow,
});
