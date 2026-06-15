const { useState, useEffect } = React;

function createFlowController(flow) {
  const listeners = new Set();
  const blank = () => flow.steps.map((s) => ({ data: JSON.parse(JSON.stringify(s.data || {})), progress: 0 }));
  let state = { active: -1, done: 0, finished: false, requested: false, steps: blank() };
  const emit = () => listeners.forEach((listener) => listener());
  const idxOf = (ref) => (typeof ref === 'number' ? ref : flow.steps.findIndex((s) => s.id === ref));
  const set = (patch) => { state = { ...state, ...patch }; emit(); };
  const editStep = (ref, fn) => {
    const i = idxOf(ref);
    if (i < 0) return;
    const steps = state.steps.slice();
    steps[i] = fn({ ...steps[i] });
    set({ steps });
  };

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getState() { return state; },
    reset() { state = { active: -1, done: 0, finished: false, requested: false, steps: blank() }; emit(); },
    requestStart() { state = { active: -1, done: 0, finished: false, requested: true, steps: blank() }; emit(); },
    activate(ref) { const i = idxOf(ref); if (i >= 0) set({ active: i, finished: false, requested: true }); },
    complete(ref, opts = {}) {
      const i = idxOf(ref);
      if (i < 0) return;
      const done = Math.max(state.done, i + 1);
      const advance = opts.advance !== false;
      set({ done, active: advance ? Math.min(i + 1, flow.steps.length) : state.active, finished: done >= flow.steps.length });
    },
    progress(ref, n) { editStep(ref, (s) => ({ ...s, progress: n })); },
    pushLog(ref, log) {
      editStep(ref, (s) => {
        const data = { ...s.data, logs: [...(s.data.logs || []), log] };
        return { ...s, data, progress: Math.max(s.progress, data.logs.length) };
      });
    },
    mergeData(ref, partial) { editStep(ref, (s) => ({ ...s, data: { ...s.data, ...partial } })); },
  };
}

function Check({ size = 18, color = '#fff', stroke = 2.5, on = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <path d="M5 12.8 L10 17.5 L19 7" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
        style={{ strokeDasharray: 28, strokeDashoffset: on ? 0 : 28, transition: 'stroke-dashoffset .42s cubic-bezier(.65,0,.35,1) .05s' }} />
    </svg>
  );
}

function ActionButton({ onClick, running, finished, label }) {
  return (
    <button className="rp-btn primary" onClick={onClick} disabled={running && !finished}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {running && !finished ? 'Running' : label}
    </button>
  );
}

function StepRow({ index, step, status }) {
  const stateText = status === 'done' ? 'Completed' : status === 'active' ? (step.working || 'Working...') : '';
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

function FlowView({ flow, active, done, finished, requested, stageIndex, stageData, stageProgress, onRun }) {
  const steps = flow.steps;
  const cur = steps[stageIndex];
  const Stage = (window.STAGES || {})[cur.type] || (() => <div className="stage-pad">Unknown stage</div>);
  const running = requested && !finished;
  const statusOf = (i) => i < done ? 'done' : (requested && i === active && !finished) ? 'active' : 'todo';
  const statusText = !requested
    ? <>Ready</>
    : finished
      ? <><b>Done</b> / {steps.length} of {steps.length} tasks complete</>
      : done > 0 && active < done
        ? <><b>Step {done}</b> complete / sharing URL</>
        : active >= 0
          ? <>Step <b>{Math.min(active + 1, steps.length)}</b> of {steps.length}</>
          : <>Starting Maestro</>;
  return (
    <div className="card">
      <div className="top">
        <div className="top-l">
          <span className="kicker"><span className="spark"></span>{flow.kicker || 'MAESTRO / LIVE'}</span>
          <h1 className="title">{flow.title}</h1>
        </div>
        <div className="top-r">
          <ActionButton onClick={onRun} running={running} finished={finished} label={flow.actionLabel || 'Create the website'} />
          <span className="status">{statusText}</span>
        </div>
      </div>
      <div className="pbar"><div className="pbar-fill" style={{ width: `${(done / steps.length) * 100}%` }}></div></div>
      <div className="body">
        <div className="steps">
          {steps.map((s, i) => <StepRow key={s.id || i} index={i} step={s} status={statusOf(i)} />)}
        </div>
        <div className="stage">
          <div className="stage-root" key={stageIndex}>
            <Stage data={stageData} progress={stageProgress} finished={finished} started={requested} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentFlow({ flow, controller, onRun }) {
  const [, force] = useState(0);
  useEffect(() => controller.subscribe(() => force((x) => x + 1)), [controller]);
  const state = controller.getState();
  const stageIndex = state.active >= 0 ? Math.min(state.active, flow.steps.length - 1) : 0;
  return (
    <FlowView
      flow={flow}
      active={state.active}
      done={state.done}
      finished={state.finished}
      requested={state.requested}
      stageIndex={stageIndex}
      stageData={state.steps[stageIndex].data || {}}
      stageProgress={state.steps[stageIndex].progress}
      onRun={onRun}
    />
  );
}

Object.assign(window, { createFlowController, AgentFlow });
