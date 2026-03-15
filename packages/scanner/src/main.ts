/**
 * Example usage of the CANSIM fetcher module.
 *
 * Table : 14-10-0287-01  –  Labour Force Survey estimates
 *                            (Unemployment rate, seasonally adjusted)
 * Vector: v2062810        –  Canada, both sexes, 15 years and over
 *
 * Run with:
 *   npx tsx src/main.ts
 *   # or, if you use bun:
 *   bun src/main.ts
 */

import { Effect, pipe } from "effect"
import {
    fetchCansimData,
    HttpClientLive,
    makeTestHttpClient,
} from "./cansim/index.js"
import type { CansimError } from "./cansim/index.js"
import { analyzeSeasonality } from "./analysis/seasonality.js"
import { saveAndOpenReport } from "./analysis/report.js"
import { saveDashboard } from "./analysis/dashboard.js"

// ---------------------------------------------------------------------------
// § 1. Live usage  (real HTTP call)
// ---------------------------------------------------------------------------

const TABLE_ID = "14-10-0287-01"
const VECTOR_ID = 2062810

const liveProgram = pipe(
    fetchCansimData(TABLE_ID, VECTOR_ID),
    Effect.provide(HttpClientLive),
    Effect.map((result) => {
        console.log("\n=== CANSIM Fetch Result ===")
        console.log("Metadata:", result.metadata)
        console.log(
            `\nTraining data [${result.trainingData.length} obs] – first 5:`
        )
        console.table(result.trainingData.slice(0, 5))
        console.log(
            `\nValidation data [${result.validationData.length} obs]:`
        )
        console.table(result.validationData)
        return result
    }),
    // Map each error tag to a user-friendly message
    Effect.catchTags({
        HttpFetchError: (e) =>
            Effect.sync(() => {
                console.error(`[Network Error] ${e.message}\nURL: ${e.url}`)
                process.exit(1)
            }),
        ApiResponseError: (e) =>
            Effect.sync(() => {
                console.error(`[API Error] ${e.message}`)
                process.exit(1)
            }),
        DataParseError: (e) =>
            Effect.sync(() => {
                console.error(`[Parse Error] ${e.message}`)
                process.exit(1)
            }),
    })
)

// ---------------------------------------------------------------------------
// § 2. Test / stub usage  (no network required)
// ---------------------------------------------------------------------------

/**
 * Build a fake WDS payload that mimics the real API structure.
 * Useful in CI / unit tests where no network access is available.
 */
const buildMockPayload = (vectorId: number, nObs: number) => {
    const vectorDataPoint = Array.from({ length: nObs }, (_, i) => {
        const year = 2015 + Math.floor(i / 12)
        const month = String((i % 12) + 1).padStart(2, "0")
        return {
            refPer: `${year}-${month}`,
            value: +(Math.random() * 5 + 3).toFixed(1), // fake unemployment rate
            releaseTime: `${year}-${month}-10T08:30`,
            statusCode: 0,
        }
    })

    return [{ status: "SUCCESS", object: { vectorId, coordinate: "1", vectorDataPoint } }]
}

const testProgram = pipe(
    fetchCansimData(TABLE_ID, VECTOR_ID),
    Effect.provide(
        makeTestHttpClient((_url) => buildMockPayload(VECTOR_ID, 130))
    ),
    Effect.map((result) => {
        console.log("\n=== CANSIM Fetch Result (MOCK) ===")
        console.log("Metadata:", result.metadata)
        console.log(`Training size : ${result.trainingData.length}`)
        console.log(`Validation size: ${result.validationData.length}`)
        return result
    })
)

// ---------------------------------------------------------------------------
// § 3. Report mode  (seasonality analysis + HTML output)
// ---------------------------------------------------------------------------

/**
 * Build a mock payload with a clear seasonal pattern (sin wave superimposed
 * on a trend) so the report mode always produces an interesting chart even
 * without a real API call.
 */
const buildSeasonalMockPayload = (vectorId: number, nObs: number) => {
    const vectorDataPoint = Array.from({ length: nObs }, (_, i) => {
        const year = 2015 + Math.floor(i / 12)
        const month = String((i % 12) + 1).padStart(2, "0")
        const seasonal = 2.5 * Math.sin((2 * Math.PI * (i % 12)) / 12)
        const trend = 0.02 * i
        const noise = (Math.random() - 0.5) * 0.4
        return {
            refPer: `${year}-${month}`,
            value: +(6 + trend + seasonal + noise).toFixed(2),
            releaseTime: `${year}-${month}-10T08:30`,
            statusCode: 0,
        }
    })
    return [{ status: "SUCCESS", object: { vectorId, coordinate: "1", vectorDataPoint } }]
}

const reportProgram = pipe(
    fetchCansimData(TABLE_ID, VECTOR_ID),
    Effect.provide(
        makeTestHttpClient((_url) => buildSeasonalMockPayload(VECTOR_ID, 130))
    ),
    Effect.flatMap((result) => {
        const analysis = analyzeSeasonality(result.trainingData)
        console.log("\n=== Seasonality Analysis ===")
        console.log(`Frequency  : s = ${analysis.frequency}`)
        console.log(`ACF r_s    : ${analysis.acfTest.acfAtSeasonalLag.toFixed(4)} (bound ±${analysis.acfTest.bound95.toFixed(4)})`)
        console.log(`F-test     : F = ${analysis.fTest.fStat.toFixed(3)},  p = ${analysis.fTest.pValue.toFixed(4)}`)
        console.log(`Verdict    : ${analysis.verdict.toUpperCase()}`)
        console.log(`\n${analysis.interpretation}\n`)
        return saveAndOpenReport(result, analysis, "output/report.html")
    }),
    Effect.catchAll((e) =>
        Effect.sync(() => console.error("[Error]", e))
    )
)

// ---------------------------------------------------------------------------
// § 4. Run
// ---------------------------------------------------------------------------

const mode = process.argv[2] ?? "mock" // "mock" | "live" | "report" | "dashboard"

if (mode === "live") {
    console.log("Running in LIVE mode – calling Statistics Canada API…")
    Effect.runPromise(liveProgram).catch(() => {
        /* errors already handled inside the Effect */
    })
} else if (mode === "report") {
    console.log("Running in REPORT mode – generating HTML report…")
    Effect.runPromise(reportProgram).catch(console.error)
} else if (mode === "dashboard") {
    console.log("Running in DASHBOARD mode – generating interactive dashboard…")
    Effect.runPromise(
        saveDashboard("output/dashboard.html").pipe(
            Effect.catchAll((e) => Effect.sync(() => console.error("[Error]", e)))
        )
    ).catch(console.error)
} else {
    console.log("Running in MOCK mode – no network request made.")
    Effect.runPromise(testProgram).catch(console.error)
}
