// stages.jsx — four stage animations, each rendered purely from props.
// Registered into window.STAGES under a `type` key so the flow can pick them.
const { useState: uS, useEffect: uE } = React;

function useTyped(text, speed = 46, delay = 400) {
  const [n, setN] = uS(0);
  uE(() => {
    setN(0); let id;
    const start = setTimeout(() => {
      id = setInterval(() => setN(x => { if (x >= text.length) { clearInterval(id); return x; } return x + 1; }), speed);
    }, delay);
    return () => { clearTimeout(start); clearInterval(id); };
  }, [text, speed, delay]);
  return text.slice(0, n);
}

// fit `n` reveals comfortably inside the step's duration.
const intervalFor = (n, duration, lo = 200, hi = 460) =>
  Math.max(lo, Math.min(hi, (duration - 900) / Math.max(n, 1)));

const srcName = (s) => (typeof s === 'string' ? s : s.name);

/* ════════════ STAGE: build ════════════
   data: { url, logs: [{ kind:'cmd'|'ok'|'arr'|'dim'|'', text }] }            */
function StageBuild({ data, duration, progress }) {
  const logs = data.logs || [];
  const n = Math.max(logs.length, 5);
  const auto = useSteps(n, intervalFor(n, duration, 240, 520), 220, progress == null);
  const p = progress == null ? auto : progress;
  const fin = p >= n;
  const cards = Math.ceil(n * 0.5), foot = Math.ceil(n * 0.62);
  const sym = { cmd: '$', ok: '✓', arr: '▸' };
  return (
    <div className="stage-pad">
      <div className="stage-cap"><span className="dot"></span>Designing &amp; building the site</div>
      <div className={`bd${fin ? ' fin' : ''}`}>
        <div className="browser">
          <div className="br-bar">
            <span className="tl"></span><span className="tl"></span><span className="tl"></span>
            <span className="br-url">{data.url || 'https://example.com'}</span>
          </div>
          <div className="br-canvas">
            <div className={`wf wf-nav${p >= 1 ? ' on' : ''}`}>
              <span className="logo"></span><span className="sp"></span>
              <span className="lnk"></span><span className="lnk"></span><span className="lnk"></span>
            </div>
            <div className={`wf wf-hero${p >= 2 ? ' on' : ''}`}>
              <div className="wf-hcol">
                <span className="wf-l lg"></span><span className="wf-l md"></span>
                <span className="wf-l sm"></span><span className="wf-pill"></span>
              </div>
              <div className="wf-img"></div>
            </div>
            <div className={`wf wf-cards${p >= cards ? ' on' : ''}`}>
              <div className="wf-card"></div><div className="wf-card"></div><div className="wf-card"></div>
            </div>
            <div className={`wf wf-foot${p >= foot ? ' on' : ''}`}></div>
          </div>
        </div>
        <div className="term">
          {logs.map((l, i) => (
            <div key={i} className={`term-row${p >= i + 1 ? ' on' : ''}`}>
              {l.kind === 'cmd' && <><span className="pr">$</span> {l.text}</>}
              {l.kind === 'ok' && <><span className="ok">✓</span> {l.text}</>}
              {l.kind === 'arr' && <><span className="arr">▸</span> {l.text}</>}
              {l.kind === 'dim' && <span className="dim">{l.text}</span>}
              {!['cmd','ok','arr','dim'].includes(l.kind) && <span>{l.text}</span>}
            </div>
          ))}
          {!fin && <div className="term-row on"><span className="term-cursor"></span></div>}
        </div>
      </div>
    </div>
  );
}

/* ════════════ STAGE: research ════════════
   data: { query, signals, sources: ["Google", ...] | [{name}] }              */
function radarPositions(n) {
  const pts = [], cx = 50, cy = 50, rx = 40, ry = 37;
  for (let i = 0; i < n; i++) {
    const a = (-90 + i * (360 / n)) * Math.PI / 180;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}
function StageResearch({ data, duration, progress }) {
  const sources = data.sources || [];
  const n = sources.length;
  const pos = radarPositions(n);
  const auto = useSteps(n, intervalFor(n, duration, 180, 420), 220, progress == null);
  const p = progress == null ? auto : progress;
  const query = useTyped(data.query || '', 36, 320);
  const signals = useCounter(data.signals || 0, Math.min(2400, duration * 0.6), 450);
  return (
    <div className="stage-pad">
      <div className="stage-cap"><span className="dot"></span>Researching the market</div>
      <div className="rs">
        <div className="rs-query">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="M16.5 16.5 L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <span className="rs-qt tw">{query}</span>
        </div>
        <div className="radar">
          <div className="radar-grid"></div>
          <div className="radar-cross" style={{ left: '50%', top: '8%', bottom: '8%', width: 1 }}></div>
          <div className="radar-cross" style={{ top: '50%', left: '8%', right: '8%', height: 1 }}></div>
          <div className="radar-sweep"></div>
          <div className="radar-core"><span>{data.coreLabel || 'AI'}</span></div>
          {sources.map((s, i) => (
            <div key={i} className={`blip${p > i ? ' on' : ''}`} style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }}>
              <span className="ring"></span><span className="nm">{srcName(s)}</span>
            </div>
          ))}
        </div>
        <div className="rs-side">
          <div className="rs-stat">
            <div className="v">{Math.round(signals).toLocaleString()}</div>
            <div className="k">Signals analyzed · {Math.min(p, n)}/{n} sources</div>
          </div>
          <div className="rs-found">
            <div className="hd">Sources scanned</div>
            {sources.map((s, i) => (
              <div key={i} className={`rs-item${p > i ? ' on' : ''}`}>
                <span className="ck"><MiniCheck /></span>{srcName(s)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════ STAGE: competitors ════════════
   data: { axes:{top,bottom,left,right},
           competitors:[{ name, score, x, y, you?, color? }] }                */
const CDOT_COLORS = ['var(--blue)', 'var(--amber)', '#9a86c9', '#3aa6a0', '#d06a8a'];
function StageCompete({ data, duration, progress }) {
  const comps = (data.competitors || []).map((c, i) => ({
    ...c, color: c.you ? 'var(--accent)' : (c.color || CDOT_COLORS[i % CDOT_COLORS.length]),
  }));
  const n = comps.length;
  // auto mode: reveal lowest score → highest (leader / "You" lands last).
  // live mode: reveal in arrival order (as each competitor is discovered).
  const phaseOf = {};
  if (progress == null) {
    const order = comps.map((c, i) => i).sort((a, b) => comps[a].score - comps[b].score);
    order.forEach((idx, rank) => { phaseOf[idx] = rank + 1; });
  } else {
    comps.forEach((c, i) => { phaseOf[i] = i + 1; });
  }
  const auto = useSteps(n, intervalFor(n, duration, 260, 520), 220, progress == null);
  const p = progress == null ? auto : progress;
  const axes = data.axes || {};
  const rows = comps.map((c, i) => ({ ...c, i })).sort((a, b) => b.score - a.score);
  return (
    <div className="stage-pad">
      <div className="stage-cap"><span className="dot"></span>Tracking &amp; analyzing competitors</div>
      <div className="cp">
        <div className="matrix">
          <div className="qbg win" style={{ left: '50%', top: 0, right: 0, height: '50%' }}></div>
          <div className="matrix-axes">
            <span className="ax-lab ax-top">{axes.top || 'High'}</span>
            <span className="ax-lab ax-bottom">{axes.bottom || 'Low'}</span>
            <span className="ax-lab ax-left">{axes.left || 'Niche'}</span>
            <span className="ax-lab ax-right">{axes.right || 'Reach'}</span>
          </div>
          {comps.map((c, i) => (
            <div key={i} className={`cdot${c.you ? ' you' : ''}${p >= phaseOf[i] ? ' on' : ''}`}
                 style={{ left: `${c.x}%`, top: `${c.y}%` }}>
              <span className="pt" style={{ background: c.color }}></span>
              <span className="cl" style={c.you ? { color: 'var(--accent)' } : undefined}>{c.name}</span>
            </div>
          ))}
        </div>
        <div className="cp-side">
          {rows.map((c) => {
            const on = p >= phaseOf[c.i];
            return (
              <div key={c.i} className={`cp-row${on ? ' on' : ''}`}>
                <div className="nm"><span className="sw" style={{ background: c.color }}></span>{c.name}</div>
                <div className="meta">
                  <span className="cp-bar"><i style={{ width: on ? `${c.score}%` : 0, background: c.color }}></i></span>
                  <span className="pct">{c.score}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════ STAGE: report ════════════
   data: { eyebrow, heading, meta:[...],
           kpis:[{ prefix, value, decimals, suffix, label }], chart:[..%] }    */
function StageReport({ data, duration, finished, progress }) {
  const kpis = data.kpis || [];
  const chart = data.chart || [];
  const n = 5 + kpis.length;            // ey → kpis → chart → lines → badge
  const auto = useSteps(n, intervalFor(n, duration, 240, 460), 220, progress == null);
  const p = progress == null ? auto : progress;
  const heading = useTyped(data.heading || '', 38, 420);
  const chartPhase = 2 + kpis.length;
  const linesPhase = chartPhase + 1;
  return (
    <div className="stage-pad">
      <div className="stage-cap"><span className="dot"></span>Compiling the report</div>
      <div className="rp">
        <div className="rp-stack">
          <div className="rp-page p3"></div>
          <div className="rp-page p2"></div>
          <div className={`rp-page p1${p >= 1 ? ' rp-on' : ''}`}>
            {data.eyebrow && <div className="rp-ey">{data.eyebrow}</div>}
            <div className="rp-h tw" style={{ borderRightColor: p >= 2 ? 'transparent' : 'currentColor' }}>{heading}</div>
            {data.meta && <div className="rp-meta">{data.meta.map((m, i) => (
              <React.Fragment key={i}>{i > 0 && <span>·</span>}<span>{m}</span></React.Fragment>))}</div>}
            <div className="rp-kpis">
              {kpis.map((k, i) => (
                <div key={i} className="rp-kpi" style={{ opacity: p >= 2 + i ? 1 : 0, transform: p >= 2 + i ? 'none' : 'translateY(6px)' }}>
                  <div className="v"><CountNum value={k.value} decimals={k.decimals || 0} prefix={k.prefix || ''} suffix={k.suffix || ''} delay={300 + i * 120} /></div>
                  <div className="k">{k.label}</div>
                </div>
              ))}
            </div>
            <div className="rp-chart">
              {chart.map((h, i) => <span key={i} className="rp-bar" style={{ height: p >= chartPhase ? `${h}%` : 0, transitionDelay: `${i * 70}ms` }}></span>)}
            </div>
            <div className="rp-lines">
              {[88, 96, 72].map((w, i) => (
                <span key={i} className={`rp-ln${p >= linesPhase ? ' on' : ''}`} style={{ width: `${w}%`, transitionDelay: `${i * 90}ms` }}></span>
              ))}
            </div>
          </div>
          <div className={`rp-badge${(p >= n || finished) ? ' on' : ''}`}><Check size={14} on={true} />{data.doneLabel || 'Report ready'}</div>
        </div>
      </div>
    </div>
  );
}

window.STAGES = { build: StageBuild, research: StageResearch, competitors: StageCompete, report: StageReport };
