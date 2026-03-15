/**
 * HTML report generator.
 *
 * Produces a single, self-contained HTML file (no build step, no local server)
 * that renders three Chart.js charts and a seasonality summary panel.
 *
 * - Chart 1: Time series  (training = blue, validation = orange)
 * - Chart 2: ACF bar chart with ±95 % confidence bounds
 * - Chart 3: Seasonal means bar chart (one bar per month / quarter)
 * - Panel  : Metadata + seasonality verdict
 *
 * No extra npm dependencies – Chart.js is loaded from jsDelivr CDN.
 */
import { Effect } from "effect"
import fs from "node:fs/promises"
import { exec } from "node:child_process"
import path from "node:path"
import type { CansimResult } from "../cansim/schema.js"
import type { SeasonalityAnalysis } from "./seasonality.js"

// ─────────────────────────────────────────────────────────────────────────────
// § 1. Pure HTML generator
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a self-contained HTML report as a string. */
export function generateReport(
  result: CansimResult,
  analysis: SeasonalityAnalysis
): string {
  const { trainingData, validationData, metadata } = result
  const { acfTest, fTest, verdict, interpretation, frequency } = analysis

  // ── Data serialisation ────────────────────────────────────────────────────
  const allLabels = [...trainingData, ...validationData].map((d) => d.date)
  const trainValues = trainingData.map((d) => d.value)
  const validValues = validationData.map((d) => d.value)

  // Align validation to the right end of the combined label axis
  const trainNulls: (number | null)[] = [
    ...Array(trainingData.length).fill(null),
    ...validationData.map((d) => d.value),
  ]

  const acfLabels = acfTest.acf.map((_, i) => `lag ${i + 1}`)
  const acfValues = acfTest.acf

  const seasonLabels =
    frequency === 12
      ? ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
      : ["Q1", "Q2", "Q3", "Q4"]

  // Verdict colour scheme
  const verdictColor: Record<SeasonalityAnalysis["verdict"], string> = {
    seasonal: "#166534",       // dark green
    not_seasonal: "#1e3a8a",   // dark blue
    inconclusive: "#92400e",   // dark amber
  }
  const verdictBg: Record<SeasonalityAnalysis["verdict"], string> = {
    seasonal: "#dcfce7",
    not_seasonal: "#dbeafe",
    inconclusive: "#fef3c7",
  }
  const verdictLabel: Record<SeasonalityAnalysis["verdict"], string> = {
    seasonal: "SEASONAL",
    not_seasonal: "NOT SEASONAL",
    inconclusive: "INCONCLUSIVE",
  }

  // ── Inline JSON blobs (avoids XSS via proper JSON.stringify) ──────────────
  const j = (v: unknown) => JSON.stringify(v)

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CANSIM Report – ${metadata.tableId}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f8fafc; color: #1e293b; padding: 2rem; }
    h1  { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.25rem; }
    h2  { font-size: 1rem; font-weight: 600; color: #475569; margin-bottom: 1rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.25rem; }
    .card.full { grid-column: 1 / -1; }
    .card h3 { font-size: 0.875rem; font-weight: 600; color: #64748b;
               text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1rem; }
    canvas { max-height: 280px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    td, th { padding: 0.4rem 0.6rem; text-align: left; border-bottom: 1px solid #f1f5f9; }
    th { color: #94a3b8; font-weight: 500; }
    .verdict-box { border-radius: 0.5rem; padding: 1rem 1.25rem; margin-top: 0.5rem;
                   border: 1px solid; }
    .verdict-tag { display: inline-block; font-weight: 700; font-size: 1rem;
                   letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .verdict-text { font-size: 0.875rem; line-height: 1.6; }
    .stats-row { display: flex; gap: 2rem; flex-wrap: wrap; margin-top: 0.75rem; font-size: 0.85rem; }
    .stat label { color: #94a3b8; display: block; font-size: 0.75rem; }
    .stat value { font-weight: 600; }
  </style>
</head>
<body>
  <h1>CANSIM Time-Series Report</h1>
  <h2>Table ${metadata.tableId} &nbsp;·&nbsp; Vector ${metadata.vectorId} &nbsp;·&nbsp; Fetched ${new Date(metadata.fetchedAt).toLocaleString()}</h2>

  <div class="grid">

    <!-- ── Chart 1: Time series ── -->
    <div class="card full">
      <h3>Time Series (training + validation)</h3>
      <canvas id="tsChart"></canvas>
    </div>

    <!-- ── Chart 2: ACF ── -->
    <div class="card">
      <h3>Sample ACF — lags 1 … ${2 * frequency} (s = ${frequency})</h3>
      <canvas id="acfChart"></canvas>
    </div>

    <!-- ── Chart 3: Seasonal means ── -->
    <div class="card">
      <h3>Seasonal Means (by ${frequency === 12 ? "month" : "quarter"})</h3>
      <canvas id="smChart"></canvas>
    </div>

    <!-- ── Info panel ── -->
    <div class="card">
      <h3>Dataset Metadata</h3>
      <table>
        <tr><th>Table ID</th><td>${metadata.tableId}</td></tr>
        <tr><th>Vector ID</th><td>${metadata.vectorId}</td></tr>
        <tr><th>Training obs</th><td>${metadata.trainingSize} (${metadata.oldestDate} → ${trainingData.at(-1)?.date ?? ""})</td></tr>
        <tr><th>Validation obs</th><td>${metadata.validationSize} (${validationData[0]?.date ?? ""} → ${metadata.newestDate})</td></tr>
        <tr><th>Detected period (s)</th><td>${frequency}</td></tr>
      </table>
    </div>

    <!-- ── Seasonality panel ── -->
    <div class="card">
      <h3>Seasonality Analysis</h3>
      <div class="verdict-box"
           style="background:${verdictBg[verdict]};border-color:${verdictColor[verdict]};color:${verdictColor[verdict]}">
        <span class="verdict-tag">${verdictLabel[verdict]}</span>
        <p class="verdict-text" style="color:#1e293b">${interpretation}</p>
      </div>
      <div class="stats-row">
        <div class="stat">
          <label>ACF r<sub>${frequency}</sub></label>
          <value>${acfTest.acfAtSeasonalLag.toFixed(4)}</value>
        </div>
        <div class="stat">
          <label>95 % bound</label>
          <value>±${acfTest.bound95.toFixed(4)}</value>
        </div>
        <div class="stat">
          <label>F statistic</label>
          <value>${fTest.fStat.toFixed(3)}</value>
        </div>
        <div class="stat">
          <label>F-test df</label>
          <value>(${fTest.dfBetween}, ${fTest.dfWithin})</value>
        </div>
        <div class="stat">
          <label>p-value</label>
          <value>${fTest.pValue < 0.0001 ? "< 0.0001" : fTest.pValue.toFixed(4)}</value>
        </div>
      </div>
    </div>

  </div><!-- /grid -->

<script>
(function () {
  /* ── shared palette ── */
  const BLUE   = "rgba(59,130,246,0.9)"
  const BLUE_F = "rgba(59,130,246,0.15)"
  const ORANGE = "rgba(249,115,22,0.9)"
  const GREY   = "rgba(100,116,139,0.6)"
  const RED    = "rgba(239,68,68,0.85)"

  /* ── 1. Time-series chart ── */
  new Chart(document.getElementById("tsChart"), {
    type: "line",
    data: {
      labels: ${j(allLabels)},
      datasets: [
        {
          label: "Training (n = ${trainingData.length})",
          data: ${j([...trainValues, ...Array(validValues.length).fill(null)])},
          borderColor: BLUE, backgroundColor: BLUE_F,
          borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.3,
        },
        {
          label: "Validation (n = ${validationData.length})",
          data: ${j(trainNulls)},
          borderColor: ORANGE, borderWidth: 2,
          borderDash: [6, 3], pointRadius: 3, fill: false,
        },
      ],
    },
    options: {
      animation: false,
      plugins: { legend: { position: "top" } },
      scales: {
        x: { ticks: { maxTicksLimit: 20, maxRotation: 45 } },
        y: { title: { display: true, text: "Value" } },
      },
    },
  })

  /* ── 2. ACF chart ── */
  const acfVals   = ${j(acfValues)}
  const bound     = ${acfTest.bound95}
  const acfColors = acfVals.map((v, i) => {
    if (i === ${frequency - 1} || i === ${2 * frequency - 1}) return RED
    return Math.abs(v) > bound ? "rgba(239,68,68,0.6)" : GREY
  })
  new Chart(document.getElementById("acfChart"), {
    type: "bar",
    data: {
      labels: ${j(acfLabels)},
      datasets: [
        {
          label: "ACF",
          data: acfVals,
          backgroundColor: acfColors,
          borderWidth: 0,
        },
        {
          label: "+95% bound",
          data: Array(${2 * frequency}).fill(bound),
          type: "line", borderColor: RED, borderWidth: 1.5,
          borderDash: [4, 3], pointRadius: 0, fill: false,
        },
        {
          label: "−95% bound",
          data: Array(${2 * frequency}).fill(-bound),
          type: "line", borderColor: RED, borderWidth: 1.5,
          borderDash: [4, 3], pointRadius: 0, fill: false,
        },
      ],
    },
    options: {
      animation: false,
      plugins: { legend: { position: "top" } },
      scales: {
        y: { min: -1, max: 1, title: { display: true, text: "r_k" } },
      },
    },
  })

  /* ── 3. Seasonal means chart ── */
  const smVals = ${j(fTest.seasonalMeans)}
  const grandMean = smVals.reduce((a, b) => a + b, 0) / smVals.length
  new Chart(document.getElementById("smChart"), {
    type: "bar",
    data: {
      labels: ${j(seasonLabels)},
      datasets: [
        {
          label: "Seasonal mean",
          data: smVals,
          backgroundColor: smVals.map((v) =>
            v > grandMean ? "rgba(59,130,246,0.7)" : "rgba(249,115,22,0.7)"
          ),
          borderWidth: 0,
        },
        {
          label: "Grand mean",
          data: Array(${frequency}).fill(grandMean),
          type: "line", borderColor: "#64748b", borderWidth: 1.5,
          borderDash: [4, 3], pointRadius: 0, fill: false,
        },
      ],
    },
    options: {
      animation: false,
      plugins: { legend: { position: "top" } },
      scales: { y: { title: { display: true, text: "Mean value" } } },
    },
  })
})()
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2. Effect-based file writer + browser opener
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write the HTML report to `outputPath` and open it in the default browser.
 *
 * Uses `Effect.tryPromise` for the file write and a fire-and-forget `exec`
 * for the browser open command (macOS `open`, Windows `start`, Linux `xdg-open`).
 */
export const saveAndOpenReport = (
  result: CansimResult,
  analysis: SeasonalityAnalysis,
  outputPath: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const html = generateReport(result, analysis)
    const absPath = path.resolve(outputPath)

    // Ensure parent directory exists
    yield* Effect.tryPromise({
      try: () => fs.mkdir(path.dirname(absPath), { recursive: true }),
      catch: (e) => new Error(`mkdir failed: ${e}`),
    })

    yield* Effect.tryPromise({
      try: () => fs.writeFile(absPath, html, "utf-8"),
      catch: (e) => new Error(`writeFile failed: ${e}`),
    })

    yield* Effect.log(`[report] Saved → ${absPath}`)

    // Open in default browser (best-effort, ignore errors)
    const openCmd =
      process.platform === "win32"
        ? `start "" "${absPath}"`
        : process.platform === "darwin"
          ? `open "${absPath}"`
          : `xdg-open "${absPath}"`

    exec(openCmd) // intentionally fire-and-forget
    yield* Effect.log(`[report] Opening in browser…`)
  })
