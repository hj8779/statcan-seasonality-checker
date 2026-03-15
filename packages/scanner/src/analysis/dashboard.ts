/**
 * Interactive CANSIM Dataset Finder & SARIMA Analyzer.
 *
 * Generates a single self-contained HTML page that:
 *  - Lets the user search by Vector ID  (direct)
 *  - Lets the user browse by Table PID (selects dimension members → coordinate)
 *  - Fetches data live from the StatCan WDS API (CORS-enabled)
 *  - Computes ACF, PACF, F-test, and a 6-point complexity score in the browser
 *  - Renders 4 Chart.js charts + analysis panels in a "report" box below
 *
 * No extra npm dependencies – Chart.js from jsDelivr CDN.
 */
import { Effect } from "effect"
import fs from "node:fs/promises"
import { exec } from "node:child_process"
import path from "node:path"

// ─────────────────────────────────────────────────────────────────────────────
export function generateDashboard(): string {
  // Embedded JavaScript is kept as a plain string to avoid template-literal
  // escaping issues with the ${...} syntax used inside the browser code.
  const JS = buildJS()
  const CSS = buildCSS()

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CANSIM SARIMA Analyzer</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <style>${CSS}</style>
</head>
<body>

<header>
  <h1>CANSIM Dataset Finder &amp; SARIMA Complexity Analyzer</h1>
  <p>Find seasonal series with complex ARIMA structure suitable for assignment 4</p>
</header>

<!-- ── Search panel ──────────────────────────────────────────────────────── -->
<div class="card" id="searchCard">
  <div class="tab-bar">
    <button class="tab active" data-tab="tabVector">By Vector ID</button>
    <button class="tab"        data-tab="tabTable" >Browse Table (PID)</button>
  </div>

  <!-- Tab 1: vector ID -->
  <div id="tabVector" class="tab-content">
    <div class="row">
      <input id="vectorInput" type="number" placeholder="Vector ID  e.g. 2062810" />
      <button id="loadVectorBtn" class="btn-primary">Load &amp; Analyze</button>
    </div>
    <p class="hint">Find the Vector ID on the Statistics Canada table page
      (look for <code>v&lt;number&gt;</code> next to each series).</p>
  </div>

  <!-- Tab 2: table PID + dimension selectors -->
  <div id="tabTable" class="tab-content" hidden>
    <div class="row">
      <input id="tableInput" placeholder="Table ID  e.g. 14-10-0287-01" />
      <button id="loadTableBtn" class="btn-primary">Browse Table</button>
    </div>
    <div id="tableInfoRow" hidden>
      <span id="tableTitle" class="table-title"></span>
    </div>
    <div id="dimensionSelectors" hidden></div>
    <div id="coordRow" hidden>
      <button id="loadCoordBtn" class="btn-primary">Load Selected Series</button>
    </div>
    <input type="hidden" id="tablePidHidden" />
  </div>

  <!-- Status bar -->
  <div id="status" class="status" hidden></div>
</div>

<!-- ── Series info + complexity ──────────────────────────────────────────── -->
<div id="seriesInfoBox" class="card" hidden>
  <div class="info-header">
    <div>
      <div id="seriesTitle" class="series-title"></div>
      <div id="seriesDetails" class="series-details"></div>
    </div>
    <div id="gradeBox" class="grade-box">
      <div class="grade-label">Assignment suitability</div>
      <div id="complexityGrade" class="grade-value"></div>
      <div id="complexityScore" class="grade-sub"></div>
    </div>
  </div>

  <div id="complexityModel" class="model-hint"></div>

  <div id="complexityCriteria" class="criteria-grid"></div>
</div>

<!-- ── Report box ────────────────────────────────────────────────────────── -->
<div id="reportBox" hidden>

  <div class="card full">
    <h3 class="chart-title">Time Series  (training = blue · validation = orange)</h3>
    <canvas id="tsChart"></canvas>
  </div>

  <div class="chart-row">
    <div class="card">
      <h3 class="chart-title">ACF  (red bars = seasonal lags)</h3>
      <canvas id="acfChart"></canvas>
    </div>
    <div class="card">
      <h3 class="chart-title">PACF  (green bars = significant)</h3>
      <canvas id="pacfChart"></canvas>
    </div>
  </div>

  <div class="chart-row">
    <div class="card">
      <h3 class="chart-title">Seasonal Means</h3>
      <canvas id="smChart"></canvas>
    </div>
    <div class="card" id="analysisPanel">
      <h3 class="chart-title">Seasonality Tests</h3>
      <div id="seasonalityVerdict" class="verdict-box">
        <div id="verdictLabel" class="verdict-tag"></div>
        <table class="stat-table">
          <tr><th>ACF r<sub id="lagLabel">s</sub></th><td id="acfStat"></td>
              <th>95% bound</th><td id="acfBound"></td></tr>
          <tr><th>F statistic</th><td id="fStat"></td>
              <th>p-value</th><td id="fPval"></td></tr>
        </table>
      </div>
    </div>
  </div>

</div><!-- /reportBox -->

<script>${JS}</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────
function buildCSS(): string {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:1.5rem;max-width:1200px;margin:0 auto}
header{margin-bottom:1.5rem}
header h1{font-size:1.4rem;font-weight:700}
header p{color:#64748b;font-size:.9rem;margin-top:.25rem}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;padding:1.25rem;margin-bottom:1.25rem}
.card.full{grid-column:1/-1}
.chart-row{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem}
.chart-title{font-size:.8rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.75rem}
canvas{max-height:260px}
.tab-bar{display:flex;gap:.5rem;margin-bottom:1rem}
.tab{padding:.4rem .9rem;border-radius:.5rem;border:1px solid #e2e8f0;background:#f1f5f9;cursor:pointer;font-size:.875rem;font-weight:500;color:#475569}
.tab.active{background:#1e40af;color:#fff;border-color:#1e40af}
.tab-content{}
.row{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
input[type=number],input[type=text],input:not([type]){padding:.5rem .75rem;border:1px solid #cbd5e1;border-radius:.5rem;font-size:.9rem;width:18rem}
.btn-primary{padding:.5rem 1.1rem;background:#1e40af;color:#fff;border:none;border-radius:.5rem;cursor:pointer;font-size:.875rem;font-weight:600;white-space:nowrap}
.btn-primary:hover{background:#1d4ed8}
.hint{font-size:.8rem;color:#94a3b8;margin-top:.5rem}
code{background:#f1f5f9;padding:.1rem .3rem;border-radius:.25rem;font-size:.8rem}
.status{margin-top:.75rem;padding:.5rem .75rem;border-radius:.5rem;font-size:.875rem}
.status.info{background:#dbeafe;color:#1e3a8a}
.status.success{background:#dcfce7;color:#166534}
.status.error{background:#fee2e2;color:#991b1b}
.table-title{font-weight:700;font-size:1rem}
#tableInfoRow{margin:.75rem 0 .5rem}
#dimensionSelectors{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem;margin:.75rem 0}
.dim-selector label{display:block;font-size:.75rem;font-weight:600;color:#64748b;margin-bottom:.25rem}
.dim-selector select{width:100%;padding:.4rem .5rem;border:1px solid #cbd5e1;border-radius:.4rem;font-size:.85rem}
#coordRow{margin-top:.75rem}
/* Series info */
.info-header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:1rem}
.series-title{font-weight:700;font-size:1rem;margin-bottom:.25rem}
.series-details{font-size:.8rem;color:#64748b}
.grade-box{text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:.5rem;padding:.6rem 1rem;min-width:160px}
.grade-label{font-size:.7rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em}
.grade-value{font-size:1.5rem;font-weight:800;margin:.15rem 0}
.grade-sub{font-size:.75rem;color:#64748b}
.model-hint{font-size:.85rem;background:#fffbeb;border:1px solid #fde68a;border-radius:.4rem;padding:.5rem .75rem;margin-bottom:.75rem;color:#78350f}
.criteria-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:.5rem}
.criterion{display:grid;grid-template-columns:1.2rem 1fr;grid-template-rows:auto auto;column-gap:.4rem;padding:.5rem .6rem;border-radius:.4rem;font-size:.82rem}
.criterion.pass{background:#f0fdf4;border:1px solid #bbf7d0}
.criterion.fail{background:#fff1f2;border:1px solid #fecdd3}
.criterion .icon{font-size:1rem;grid-row:1/3;align-self:center}
.criterion.pass .icon{color:#16a34a}
.criterion.fail .icon{color:#dc2626}
.cname{font-weight:600;color:#374151}
.cval{color:#6b7280;font-size:.78rem}
.chint{grid-column:2/3;color:#9ca3af;font-style:italic;font-size:.78rem}
/* Analysis panel */
.verdict-box{border-radius:.4rem;padding:.75rem;border:1px solid}
.verdict-tag{font-weight:800;font-size:1.1rem;letter-spacing:.04em;margin-bottom:.4rem}
.stat-table{width:100%;border-collapse:collapse;font-size:.82rem;margin-top:.4rem}
.stat-table th{color:#94a3b8;font-weight:500;padding:.25rem .4rem}
.stat-table td{font-weight:600;padding:.25rem .4rem}
`
}

// ─────────────────────────────────────────────────────────────────────────────
// JavaScript (runs inside the browser)
// ─────────────────────────────────────────────────────────────────────────────
function buildJS(): string {
  return `
'use strict';
// ── Constants ──────────────────────────────────────────────────────────────
const API = 'https://www150.statcan.gc.ca/t1/tbl1/en/dtbl';
const N_TOTAL = 112, N_VALIDATION = 12, N_TRAINING = 100;

// ── Math helpers ───────────────────────────────────────────────────────────
function mean(xs) { return xs.reduce((a,b) => a+b, 0) / xs.length; }

function computeAcf(values, maxLag) {
  const n = values.length, mu = mean(values);
  const denom = values.reduce((s,x) => s + (x-mu)**2, 0);
  if (denom === 0) return Array(maxLag).fill(0);
  return Array.from({length: maxLag}, (_,k) => {
    let num = 0;
    for (let t = k+1; t < n; t++) num += (values[t]-mu) * (values[t-k-1]-mu);
    return num / denom;
  });
}

// Durbin-Levinson recursion
function computePacf(acfArr) {
  const n = acfArr.length;
  if (n === 0) return [];
  const getR = j => j === 0 ? 1 : (acfArr[j-1] ?? 0);
  const pacf = [acfArr[0]];
  let phi = [acfArr[0]];
  for (let k = 1; k < n; k++) {
    let num = getR(k+1), den = 1;
    for (let j = 1; j <= k; j++) {
      num -= phi[j-1] * getR(k+1-j);
      den -= phi[j-1] * getR(j);
    }
    const pk = Math.abs(den) > 1e-10 ? num/den : 0;
    const newPhi = [...phi.map((v,j) => v - pk * (phi[k-1-j] ?? 0)), pk];
    phi = newPhi;
    pacf.push(pk);
  }
  return pacf;
}

// Log-gamma (Lanczos)
function lgamma(x) {
  const c=[76.18009172947146,-86.50532032941677,24.01409824083091,
           -1.231739572450155,1.208650973866179e-3,-5.395239384953e-6];
  let y=x, tmp=x+5.5-(x+0.5)*Math.log(x+5.5), ser=1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

// Regularised incomplete beta (Lentz)
function ibeta(x, a, b) {
  if (x<=0) return 0; if (x>=1) return 1;
  if (x > (a+1)/(a+b+2)) return 1 - ibeta(1-x, b, a);
  const lnB = lgamma(a)+lgamma(b)-lgamma(a+b);
  const front = Math.exp(a*Math.log(x)+b*Math.log(1-x)-lnB)/a;
  const FPMIN=1e-30, EPS=3e-7;
  let c=1, d=1-(a+b)*x/(a+1);
  if (Math.abs(d)<FPMIN) d=FPMIN; d=1/d; let h=d;
  for (let m=1; m<=200; m++) {
    let aa=m*(b-m)*x/((a+2*m-1)*(a+2*m));
    d=1+aa*d; if(Math.abs(d)<FPMIN)d=FPMIN;
    c=1+aa/c; if(Math.abs(c)<FPMIN)c=FPMIN;
    d=1/d; h*=d*c;
    aa=-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1));
    d=1+aa*d; if(Math.abs(d)<FPMIN)d=FPMIN;
    c=1+aa/c; if(Math.abs(c)<FPMIN)c=FPMIN;
    d=1/d; const del=d*c; h*=del;
    if (Math.abs(del-1)<EPS) break;
  }
  return front*h;
}

// Exact F upper-tail p-value
function fPValue(f, d1, d2) {
  if (f<=0) return 1;
  return ibeta(d2/(d2+d1*f), d2/2, d1/2);
}

// ── Frequency detection ────────────────────────────────────────────────────
function detectFreq(dates) {
  const months = new Set(dates.map(d => d.split('-')[1] ?? ''));
  return months.size >= 10 ? 12 : 4;
}

// ── Main analysis ──────────────────────────────────────────────────────────
function analyze(trainingData) {
  const s = detectFreq(trainingData.map(d => d.date));
  const values = trainingData.map(d => d.value);
  const n = values.length;
  const bound = 1.96 / Math.sqrt(n);

  const acf  = computeAcf(values, 2*s);
  const pacf = computePacf(acf);

  const acfAtS = acf[s-1] ?? 0;
  const acfSig = Math.abs(acfAtS) > bound;

  // F-test for seasonal means
  const groups = Array.from({length: s}, () => []);
  for (const {date, value} of trainingData) {
    const m = parseInt(date.split('-')[1] ?? '1', 10);
    groups[(m-1) % s].push(value);
  }
  const grandMean = mean(values);
  const seasonalMeans = groups.map(g => g.length ? mean(g) : 0);
  const ssBw = groups.reduce((a,g,j) => a + g.length*(seasonalMeans[j]-grandMean)**2, 0);
  const ssWi = groups.reduce((a,g,j) => a + g.reduce((b,x) => b+(x-seasonalMeans[j])**2, 0), 0);
  const dfB = s-1, dfW = n-s;
  const fStat = dfW>0 && ssWi>0 ? (ssBw/dfB)/(ssWi/dfW) : 0;
  const pValue = fPValue(fStat, dfB, dfW);
  const fSig = pValue < 0.05;
  const verdict = (acfSig && fSig) ? 'seasonal'
                : (!acfSig && !fSig) ? 'not_seasonal' : 'inconclusive';

  const complexity = scoreComplexity(values, acf, pacf, bound, s);

  return {s, acf, pacf, bound, acfAtS, acfSig, fStat, pValue, fSig,
          verdict, seasonalMeans, complexity};
}

// ── Complexity scoring (6 criteria → suitability grade) ───────────────────
function scoreComplexity(values, acf, pacf, bound, s) {
  // non-seasonal significant lags (exclude lags s and 2s)
  const isSeasonalLag = i => i === s-1 || i === 2*s-1;
  const sigAcfNS  = acf.slice(0,2*s).filter((_,i) => !isSeasonalLag(i) && Math.abs(acf[i])  > bound).length;
  const sigPacfNS = acf.slice(0,2*s).filter((_,i) => !isSeasonalLag(i) && Math.abs(pacf[i] ?? 0) > bound).length;
  const acfAtS  = Math.abs(acf[s-1]  ?? 0);
  const acfAt2S = Math.abs(acf[2*s-1] ?? 0);
  const pacfAtS = Math.abs(pacf[s-1] ?? 0);
  const ss = acfAtS / bound;
  const r1 = Math.abs(acf[0] ?? 0);
  const mixed = sigAcfNS > 1 && sigPacfNS > 1;

  const crit = [
    { name: 'Strong seasonal pattern',
      pass: ss > 3,
      value: 'r_' + s + ' = ' + acfAtS.toFixed(3) + '  (' + ss.toFixed(1) + '× bound)',
      hint: ss > 5 ? 'Very strong seasonality (excellent)' : ss > 3 ? 'Clear seasonality' :
            ss > 1 ? 'Weak seasonality — marginal' : 'No seasonality detected — AVOID' },

    { name: 'Non-stationarity (needs differencing)',
      pass: r1 > 0.6,
      value: 'r₁ = ' + r1.toFixed(3),
      hint: r1 > 0.7 ? 'Strong trend / unit root — d ≥ 1 needed' :
            r1 > 0.6 ? 'Likely non-stationary' : 'May already be stationary' },

    { name: 'Complex AR structure  (PACF: ≥ 2 non-seasonal lags)',
      pass: sigPacfNS > 1,
      value: sigPacfNS + ' significant non-seasonal PACF lags',
      hint: sigPacfNS > 3 ? 'High AR order — complex' :
            sigPacfNS === 1 ? 'Likely AR(1) only — too simple' : 'No AR pattern' },

    { name: 'Complex MA structure  (ACF: ≥ 2 non-seasonal lags)',
      pass: sigAcfNS > 1,
      value: sigAcfNS + ' significant non-seasonal ACF lags',
      hint: sigAcfNS > 3 ? 'High MA order — complex' :
            sigAcfNS === 1 ? 'Likely MA(1) only — too simple' : 'No MA pattern' },

    { name: 'Mixed ARMA  (both ACF and PACF tail off)',
      pass: mixed,
      value: mixed ? 'Both ACF and PACF have multiple significant lags' :
             'One of ACF / PACF cuts off sharply',
      hint: mixed ? 'ARMA(p,q) model needed — good complexity' :
            'Pure AR or MA model — consider a more complex series' },

    { name: 'Seasonal ARMA component  (P or Q ≥ 1)',
      pass: acfAt2S > bound || pacfAtS > bound,
      value: 'ACF(2s)=' + acfAt2S.toFixed(3) + '  PACF(s)=' + pacfAtS.toFixed(3),
      hint: (acfAt2S > bound || pacfAtS > bound)
            ? 'Seasonal MA/AR component needed'
            : 'Simple seasonal differencing may suffice' },
  ];

  const score = crit.filter(c => c.pass).length;
  const GRADES = ['AVOID (0/6)', 'AVOID (1/6)', 'MARGINAL (2/6)', 'MARGINAL (3/6)',
                  'GOOD (4/6)', 'EXCELLENT (5/6)', 'EXCELLENT (6/6)'];
  const COLORS = ['#991b1b','#b91c1c','#92400e','#78350f','#1e3a8a','#166534','#14532d'];
  const grade = GRADES[score] ?? String(score);
  const gradeColor = COLORS[score] ?? '#374151';

  // Tentative model suggestion
  const p = sigPacfNS > 0 ? Math.min(sigPacfNS, 2) : 1;
  const q = sigAcfNS  > 0 ? Math.min(sigAcfNS,  2) : 1;
  const P = pacfAtS > bound ? 1 : 0;
  const Q = acfAtS  > bound ? 1 : 0;
  const D = 1, d = r1 > 0.5 ? 1 : 0;
  const modelHint = '💡 Tentative model: SARIMA(' + p + ',' + d + ',' + q + ')(' + P + ',' + D + ',' + Q + ')_' + s +
                    ' — verify with SAS ACF/PACF diagnostics';

  return { score, grade, gradeColor, crit, modelHint };
}

// ── Data pipeline ──────────────────────────────────────────────────────────
function processPoints(pts) {
  const all = pts.filter(p => p.value !== null)
                 .map(p => ({date: p.refPer, value: p.value}))
                 .sort((a,b) => a.date.localeCompare(b.date));
  const win = all.slice(-N_TOTAL);
  return { trainingData: win.slice(0, N_TRAINING),
           validationData: win.slice(N_TRAINING) };
}

// ── StatCan API calls ──────────────────────────────────────────────────────
async function apiFetch(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
  return r.json();
}
const fetchSeriesInfo   = v  => apiFetch('!getSeriesInfoFromVector/' + v);
const fetchVectorData   = v  => apiFetch('!getDataFromVectorAndLatestNPeriods/' + v + '/112');
const fetchTableMeta    = p  => apiFetch('!getCubeMetadata/' + p);
const fetchCoordData    = (p,c) => apiFetch('!getDataFromCubePidCoordAndLatestNPeriods/' + p + '/' + c + '/112');

function normPid(s) { return s.replace(/\\D/g,'').slice(0,8); }

// ── Charts ─────────────────────────────────────────────────────────────────
let _charts = {};
function killCharts() { Object.values(_charts).forEach(c => c.destroy()); _charts = {}; }

function renderCharts(td, vd, ana) {
  killCharts();
  const {s, acf, pacf, bound, seasonalMeans} = ana;
  const all = [...td, ...vd];
  const BLUE='rgba(59,130,246,0.9)', BLUE_F='rgba(59,130,246,0.12)';
  const ORA='rgba(249,115,22,0.9)', RED='rgba(239,68,68,0.85)';
  const GRN='rgba(16,185,129,0.75)', GREY='rgba(100,116,139,0.55)';

  // 1. Time series
  _charts.ts = new Chart(document.getElementById('tsChart'), {
    type:'line',
    data: { labels: all.map(d=>d.date), datasets:[
      { label:'Training (' + td.length + ')',
        data:[...td.map(d=>d.value), ...Array(vd.length).fill(null)],
        borderColor:BLUE, backgroundColor:BLUE_F, borderWidth:1.5,
        pointRadius:0, fill:true, tension:0.3 },
      { label:'Validation (' + vd.length + ')',
        data:[...Array(td.length).fill(null), ...vd.map(d=>d.value)],
        borderColor:ORA, borderWidth:2, borderDash:[6,3], pointRadius:3, fill:false }
    ]},
    options:{animation:false, plugins:{legend:{position:'top'}},
             scales:{x:{ticks:{maxTicksLimit:20}}}}
  });

  // 2. ACF
  const acfCol = acf.map((_,i) =>
    (i===s-1||i===2*s-1) ? RED : Math.abs(acf[i])>bound ? 'rgba(239,68,68,0.55)' : GREY);
  _charts.acf = new Chart(document.getElementById('acfChart'), {
    type:'bar',
    data:{ labels:acf.map((_,i)=>i+1), datasets:[
      { label:'ACF', data:acf, backgroundColor:acfCol, borderWidth:0 },
      { data:Array(acf.length).fill(bound),  type:'line', borderColor:RED,
        borderWidth:1.2, borderDash:[4,3], pointRadius:0, fill:false, label:'+95%' },
      { data:Array(acf.length).fill(-bound), type:'line', borderColor:RED,
        borderWidth:1.2, borderDash:[4,3], pointRadius:0, fill:false, label:'-95%' }
    ]},
    options:{animation:false, plugins:{legend:{display:false}},
             scales:{y:{min:-1,max:1,title:{display:true,text:'r_k'}}}}
  });

  // 3. PACF
  const pacfCol = pacf.map((_,i) =>
    i===s-1 ? RED : Math.abs(pacf[i])>bound ? GRN : GREY);
  _charts.pacf = new Chart(document.getElementById('pacfChart'), {
    type:'bar',
    data:{ labels:pacf.map((_,i)=>i+1), datasets:[
      { label:'PACF', data:pacf, backgroundColor:pacfCol, borderWidth:0 },
      { data:Array(pacf.length).fill(bound),  type:'line', borderColor:RED,
        borderWidth:1.2, borderDash:[4,3], pointRadius:0, fill:false, label:'+95%' },
      { data:Array(pacf.length).fill(-bound), type:'line', borderColor:RED,
        borderWidth:1.2, borderDash:[4,3], pointRadius:0, fill:false, label:'-95%' }
    ]},
    options:{animation:false, plugins:{legend:{display:false}},
             scales:{y:{min:-1,max:1,title:{display:true,text:'φ_kk'}}}}
  });

  // 4. Seasonal means
  const sLabels = s===12
    ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    : ['Q1','Q2','Q3','Q4'];
  const gm = mean(seasonalMeans);
  _charts.sm = new Chart(document.getElementById('smChart'), {
    type:'bar',
    data:{ labels:sLabels, datasets:[
      { label:'Mean', data:seasonalMeans,
        backgroundColor:seasonalMeans.map(v=>v>gm?BLUE:'rgba(249,115,22,0.7)'),
        borderWidth:0 },
      { data:Array(s).fill(gm), type:'line', borderColor:'#64748b',
        borderWidth:1.5, borderDash:[4,3], pointRadius:0, fill:false, label:'Grand mean' }
    ]},
    options:{animation:false, plugins:{legend:{display:false}}}
  });
}

// ── UI helpers ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $(id).hidden = false;
const hide = id => $(id).hidden = true;

function setStatus(msg, type='info') {
  const el = $('status');
  el.textContent = msg; el.className = 'status ' + type; el.hidden = false;
}

const FREQ_LABELS = {6:'Monthly (s=12)', 9:'Quarterly (s=4)', 12:'Annual', 1:'Daily'};

function renderInfo(info) {
  $('seriesTitle').textContent = info.SeriesTitleEn ?? 'Unknown';
  $('seriesDetails').textContent =
    'Vector ' + info.vectorId + '  ·  Table ' + info.productId +
    '  ·  ' + (FREQ_LABELS[info.frequencyCode] ?? 'freq=' + info.frequencyCode) +
    '  ·  ' + (info.startDate?.slice(0,7) ?? '?') + ' → ' + (info.endDate?.slice(0,7) ?? '?');
  show('seriesInfoBox');
}

function renderComplexity(cx) {
  $('complexityGrade').textContent = cx.grade;
  $('complexityGrade').style.color = cx.gradeColor;
  $('complexityScore').textContent = cx.score + ' / 6 criteria met';
  $('complexityModel').textContent = cx.modelHint;
  $('complexityCriteria').innerHTML = cx.crit.map(c =>
    '<div class="criterion ' + (c.pass?'pass':'fail') + '">' +
    '<span class="icon">' + (c.pass?'✓':'✗') + '</span>' +
    '<span class="cname">' + c.name + '</span>' +
    '<span class="cval">' + c.value + '</span>' +
    '<span class="chint">' + c.hint + '</span>' +
    '</div>'
  ).join('');
}

const VCOLOR = {seasonal:'#166534', not_seasonal:'#1e3a8a', inconclusive:'#92400e'};
const VBGC   = {seasonal:'#dcfce7', not_seasonal:'#dbeafe', inconclusive:'#fef3c7'};
const VLBL   = {seasonal:'SEASONAL', not_seasonal:'NOT SEASONAL', inconclusive:'INCONCLUSIVE'};

function renderAnalysisPanel(ana) {
  const v = ana.verdict;
  const box = $('seasonalityVerdict');
  box.style.background = VBGC[v]; box.style.color = VCOLOR[v]; box.style.borderColor = VCOLOR[v];
  $('verdictLabel').textContent = VLBL[v];
  $('lagLabel').textContent = ana.s;
  $('acfStat').textContent  = ana.acfAtS.toFixed(4);
  $('acfBound').textContent = '±' + ana.bound.toFixed(4);
  $('fStat').textContent    = ana.fStat.toFixed(3);
  $('fPval').textContent    = ana.pValue < 0.0001 ? '< 0.0001' : ana.pValue.toFixed(4);
}

// ── Core load function ─────────────────────────────────────────────────────
async function loadAndAnalyze(vectorId) {
  setStatus('Fetching from Statistics Canada…', 'info');
  try {
    const [infoArr, dataArr] = await Promise.all([fetchSeriesInfo(vectorId), fetchVectorData(vectorId)]);
    const infoItem = infoArr[0]; const dataItem = dataArr[0];
    if (infoItem?.status !== 'SUCCESS') throw new Error('Vector ' + vectorId + ' not found');
    if (dataItem?.status !== 'SUCCESS') throw new Error('Data fetch failed for vector ' + vectorId);

    const {trainingData, validationData} = processPoints(dataItem.object.vectorDataPoint);
    if (trainingData.length < 24) throw new Error('Only ' + trainingData.length + ' obs — need at least 24');

    setStatus('Running analysis…', 'info');
    const ana = analyze(trainingData);

    renderInfo(infoItem.object);
    renderComplexity(ana.complexity);
    renderCharts(trainingData, validationData, ana);
    renderAnalysisPanel(ana);
    show('reportBox');
    $('reportBox').scrollIntoView({behavior:'smooth'});
    setStatus('Done — ' + trainingData.length + ' training + ' + validationData.length + ' validation obs.', 'success');
  } catch(e) {
    setStatus('Error: ' + (e.message ?? e), 'error');
  }
}

// ── Table browse ───────────────────────────────────────────────────────────
async function loadTableMeta() {
  const pid = normPid($('tableInput').value.trim());
  if (pid.length < 8) { setStatus('Enter a valid table ID  (e.g. 14-10-0287-01)', 'error'); return; }
  setStatus('Loading table metadata…', 'info');
  try {
    const resp = await fetchTableMeta(pid);
    const item = resp[0];
    if (item?.status !== 'SUCCESS') throw new Error('Table ' + pid + ' not found');
    const meta = item.object;
    $('tableTitle').textContent = meta.cubeTitleEn ?? pid;
    $('tablePidHidden').value = pid;

    // Build dimension selectors from dimension members
    const container = $('dimensionSelectors');
    container.innerHTML = '';
    for (const dim of (meta.dimension ?? [])) {
      const topMembers = dim.member.filter(m => m.parentMemberId === 0);
      if (topMembers.length === 0) continue;
      const d = document.createElement('div');
      d.className = 'dim-selector';
      const lbl = document.createElement('label');
      lbl.textContent = dim.dimensionNameEn;
      const sel = document.createElement('select');
      sel.dataset.pos = dim.dimensionPositionId;
      for (const m of topMembers) {
        const opt = document.createElement('option');
        opt.value = m.memberId; opt.textContent = m.memberNameEn;
        sel.appendChild(opt);
      }
      d.appendChild(lbl); d.appendChild(sel);
      container.appendChild(d);
    }
    show('tableInfoRow'); show('dimensionSelectors'); show('coordRow');
    setStatus('Select dimension members then click "Load Selected Series"', 'info');
  } catch(e) {
    setStatus('Error: ' + (e.message ?? e), 'error');
  }
}

async function loadCoordSeries() {
  const pid = $('tablePidHidden').value;
  const sels = [...document.querySelectorAll('#dimensionSelectors select')]
    .sort((a,b) => Number(a.dataset.pos) - Number(b.dataset.pos));
  const coord = sels.map(s => s.value).join('.');
  setStatus('Fetching ' + pid + ' / ' + coord + ' …', 'info');
  try {
    const arr = await fetchCoordData(pid, coord);
    const item = arr[0];
    if (item?.status !== 'SUCCESS') throw new Error('Coordinate ' + coord + ' not found in table ' + pid);
    await loadAndAnalyze(item.object.vectorId);
  } catch(e) {
    setStatus('Error: ' + (e.message ?? e), 'error');
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(t => { t.hidden = true; });
      $(btn.dataset.tab).hidden = false;
    });
  });

  // Vector ID tab
  $('loadVectorBtn').addEventListener('click', () => {
    const v = parseInt($('vectorInput').value, 10);
    if (!v || v <= 0) { setStatus('Enter a valid positive vector ID', 'error'); return; }
    loadAndAnalyze(v);
  });
  $('vectorInput').addEventListener('keydown', e => { if (e.key==='Enter') $('loadVectorBtn').click(); });

  // Table browse tab
  $('loadTableBtn').addEventListener('click', loadTableMeta);
  $('loadCoordBtn').addEventListener('click', loadCoordSeries);
  $('tableInput').addEventListener('keydown', e => { if (e.key==='Enter') $('loadTableBtn').click(); });
});
`
}

// ─────────────────────────────────────────────────────────────────────────────
// Effect-based file writer + browser opener
// ─────────────────────────────────────────────────────────────────────────────
export const saveDashboard = (
  outputPath: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const html = generateDashboard()
    const absPath = path.resolve(outputPath)
    yield* Effect.tryPromise({
      try: () => fs.mkdir(path.dirname(absPath), { recursive: true }),
      catch: (e) => new Error(`mkdir: ${e}`),
    })
    yield* Effect.tryPromise({
      try: () => fs.writeFile(absPath, html, "utf-8"),
      catch: (e) => new Error(`writeFile: ${e}`),
    })
    yield* Effect.log(`[dashboard] Saved → ${absPath}`)
    const openCmd =
      process.platform === "win32" ? `start "" "${absPath}"` :
      process.platform === "darwin" ? `open "${absPath}"` :
      `xdg-open "${absPath}"`
    exec(openCmd)
    yield* Effect.log(`[dashboard] Opening in browser…`)
  })
