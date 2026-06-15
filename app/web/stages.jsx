const { useState: useS, useEffect: useE } = React;

function useCounter(target, dur = 900, delay = 80) {
  const [value, setValue] = useS(0);
  useE(() => {
    let id;
    let i = 0;
    const total = Math.max(1, Math.round(dur / 40));
    const start = setTimeout(() => {
      id = setInterval(() => {
        i += 1;
        const k = Math.min(1, i / total);
        setValue(target * (1 - Math.pow(1 - k, 3)));
        if (k >= 1) clearInterval(id);
      }, 40);
    }, delay);
    return () => { clearTimeout(start); clearInterval(id); };
  }, [target, dur, delay]);
  return value;
}

function CountNum({ value, decimals = 0, prefix = '', suffix = '' }) {
  const v = useCounter(value);
  return <>{prefix}{v.toFixed(decimals)}{suffix}</>;
}

function StageBuild({ data, progress, started }) {
  const logs = data.logs || [];
  const p = progress || 0;
  const fin = p >= 5 || logs.some((line) => `${line.text}`.startsWith('live'));
  const liveUrl = typeof data.url === 'string' && /^https?:\/\//.test(data.url) ? data.url : '';
  return (
    <div className="stage-pad">
      <div className="stage-cap"><span className="dot"></span>Designing &amp; building the site</div>
      <div className={`bd${fin ? ' fin' : ''}`}>
        <div className="browser">
          <div className="br-bar">
            <span className="tl"></span><span className="tl"></span><span className="tl"></span>
            {liveUrl
              ? <a className="br-url" href={liveUrl} target="_blank" rel="noreferrer">{liveUrl}</a>
              : <span className="br-url">{data.url || 'Waiting for Railway URL'}</span>}
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
            <div className={`wf wf-cards${p >= 3 ? ' on' : ''}`}>
              <div className="wf-card"></div><div className="wf-card"></div><div className="wf-card"></div>
            </div>
            <div className={`wf wf-foot${p >= 4 ? ' on' : ''}`}></div>
          </div>
        </div>
        {liveUrl && (
          <div className="share-url">
            <span>Share this URL</span>
            <a href={liveUrl} target="_blank" rel="noreferrer">{liveUrl}</a>
          </div>
        )}
        <div className="term">
          {logs.map((line, i) => (
            <div key={i} className="term-row on">
              {line.kind === 'cmd' && <><span className="pr">$</span> {line.text}</>}
              {line.kind === 'ok' && <><span className="ok">ok</span> {line.text}</>}
              {line.kind === 'arr' && <><span className="arr">&gt;</span> {line.text}</>}
              {line.kind === 'dim' && <span className="dim">{line.text}</span>}
              {!['cmd','ok','arr','dim'].includes(line.kind) && <span>{line.text}</span>}
            </div>
          ))}
          {started && !fin && <div className="term-row on"><span className="term-cursor"></span></div>}
        </div>
      </div>
    </div>
  );
}

function reportSummary(data) {
  if (data.summary) return data.summary;
  const kpis = Array.isArray(data.kpis) ? data.kpis : [];
  const score = kpis.find((k) => k.label === 'SEO score')?.value;
  const issues = kpis.find((k) => k.label === 'Issues found')?.value;
  const fixes = kpis.find((k) => k.label === 'Fixes proposed')?.value;
  if (typeof score !== 'number' || typeof issues !== 'number' || typeof fixes !== 'number') return '';
  return `Max ran Lighthouse SEO on the generated preview, scored ${score}%, found ${issues} issue${issues === 1 ? '' : 's'}, and proposed ${fixes} fix${fixes === 1 ? '' : 'es'}.`;
}

function StageReport({ data, progress, finished }) {
  const kpis = data.kpis || [];
  const chart = data.chart || [];
  const p = progress || 0;
  const summary = reportSummary(data);
  const auditedUrl = typeof data.auditedUrl === 'string' && /^https?:\/\//.test(data.auditedUrl) ? data.auditedUrl : '';
  return (
    <div className="stage-pad">
      <div className="stage-cap"><span className="dot"></span>Compiling the SEO report</div>
      <div className="rp">
        <div className="rp-stack">
          <div className="rp-page p3"></div>
          <div className="rp-page p2"></div>
          <div className={`rp-page p1${p >= 1 ? ' rp-on' : ''}`}>
            {data.eyebrow && <div className="rp-ey">{data.eyebrow}</div>}
            <div className="rp-h">{data.heading || 'Waiting for Max'}</div>
            {data.meta && <div className="rp-meta">{data.meta.map((m, i) => (
              <React.Fragment key={i}>{i > 0 && <span>/</span>}<span>{m}</span></React.Fragment>))}
            </div>}
            {auditedUrl && (
              <div className="audit-url">
                <span>Audited preview</span>
                <a href={auditedUrl} target="_blank" rel="noreferrer">{auditedUrl}</a>
              </div>
            )}
            <div className="rp-kpis">
              {kpis.map((k, i) => (
                <div key={i} className="rp-kpi" style={{ opacity: p >= 2 + i ? 1 : 0, transform: p >= 2 + i ? 'none' : 'translateY(6px)' }}>
                  <div className="v"><CountNum value={k.value || 0} decimals={k.decimals || 0} prefix={k.prefix || ''} suffix={k.suffix || ''} /></div>
                  <div className="k">{k.label}</div>
                </div>
              ))}
            </div>
            <div className="rp-chart">
              {chart.map((h, i) => <span key={i} className="rp-bar" style={{ height: p >= 5 ? `${h}%` : 0, transitionDelay: `${i * 70}ms` }}></span>)}
            </div>
            <div className="rp-lines">
              {[88, 96, 72].map((w, i) => <span key={i} className={`rp-ln${p >= 5 ? ' on' : ''}`} style={{ width: `${w}%` }}></span>)}
            </div>
            {(summary || data.suggestions || data.acknowledgement) && (
              <div className={`rp-summary${p >= 5 || finished ? ' on' : ''}`}>
                {summary && <p>{summary}</p>}
                {Array.isArray(data.suggestions) && data.suggestions.length > 0 && (
                  <ul>
                    {data.suggestions.slice(0, 3).map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                )}
                {data.acknowledgement && <p className="rp-ack">{data.acknowledgement}</p>}
              </div>
            )}
          </div>
          <div className={`rp-badge${(p >= 5 || finished) ? ' on' : ''}`}><Check size={14} />{data.doneLabel || 'Handed to Maestro'}</div>
        </div>
      </div>
    </div>
  );
}

window.STAGES = { build: StageBuild, report: StageReport };
