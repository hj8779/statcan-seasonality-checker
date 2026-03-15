import { Effect } from "effect"
import { ApiResponseError, type CansimError } from "./errors.js"
import { HttpClient, HttpClientLive } from "./httpClient.js"
import { fetchWdsVector, normalizeDataPoints } from "./api.js"
import { type CansimResult, type Metadata } from "./schema.js"

// ---------------------------------------------------------------------------
// Window constants
// ---------------------------------------------------------------------------

/** Total observations to request from the API. */
const N_TOTAL = 112

/** Newest observations reserved for out-of-sample evaluation. */
const N_VALIDATION = 12

/** Oldest observations used for model fitting. */
const N_TRAINING = N_TOTAL - N_VALIDATION // 100

// ---------------------------------------------------------------------------
// Public Effect-based API
// ---------------------------------------------------------------------------

/**
 * Fetch time-series observations for a single Statistics Canada vector and
 * partition them into a training set and a validation set.
 *
 * Data-window logic (all steps operate on chronologically sorted data):
 *  1. Request the latest `N_TOTAL` (112) periods from the WDS API.
 *  2. Drop null-valued observations (suppressed data points).
 *  3. Take the N_TOTAL most recent non-null observations.
 *  4. trainingData   = oldest 100 observations  → model fitting
 *  5. validationData = newest  12 observations  → out-of-sample evaluation
 *
 * @param tableId  CANSIM Table ID, e.g. `"14-10-0287-01"`.
 *                 Used only for metadata – the actual HTTP request uses
 *                 `vectorId` which uniquely identifies a series.
 * @param vectorId Statistics Canada vector ID, e.g. `2062810`.
 *                 Find it on the table page or via the WDS search endpoint.
 *
 * @returns An Effect that:
 *  - Requires  `HttpClient` (injected via a Layer at the call-site).
 *  - Fails with `CansimError` (HttpFetchError | ApiResponseError | DataParseError).
 *  - Succeeds with `CansimResult` containing `trainingData`, `validationData`,
 *    and `metadata`.
 *
 * @example
 * ```ts
 * // With the live HTTP client:
 * const result = await fetchCansimData("14-10-0287-01", 2062810).pipe(
 *   Effect.provide(HttpClientLive),
 *   Effect.runPromise
 * )
 *
 * // With a test stub:
 * const result = await fetchCansimData("14-10-0287-01", 2062810).pipe(
 *   Effect.provide(makeTestHttpClient(() => mockPayload)),
 *   Effect.runPromise
 * )
 * ```
 */
export const fetchCansimData = (
    tableId: string,
    vectorId: number
): Effect.Effect<CansimResult, CansimError, HttpClient> =>
    Effect.gen(function* () {
        yield* Effect.log(
            `[cansim] Fetching vector=${vectorId} table=${tableId}  ` +
            `(requesting latest ${N_TOTAL} periods)`
        )

        // ── 1. Fetch raw WDS data ──────────────────────────────────────────────
        const wdsItem = yield* fetchWdsVector(vectorId, N_TOTAL)

        // ── 2. Normalize & sort chronologically ───────────────────────────────
        const allPoints = normalizeDataPoints(wdsItem.object.vectorDataPoint)

        if (allPoints.length === 0) {
            // Fail early with a helpful message rather than returning empty arrays.
            return yield* Effect.fail(
                new ApiResponseError({ message: "Vector has no non-null observations." })
            )
        }

        if (allPoints.length < N_TOTAL) {
            yield* Effect.logWarning(
                `[cansim] Only ${allPoints.length} valid observations available ` +
                `(requested ${N_TOTAL}). ` +
                `Training set will have ${Math.max(0, allPoints.length - N_VALIDATION)} ` +
                `observations instead of ${N_TRAINING}.`
            )
        }

        // ── 3. Window: take the N_TOTAL most recent ────────────────────────────
        // .slice(-N_TOTAL) keeps the tail of an already-sorted array.
        const windowed = allPoints.slice(-N_TOTAL)

        // ── 4. Partition ───────────────────────────────────────────────────────
        const trainingData = windowed.slice(0, N_TRAINING)     // oldest 100
        const validationData = windowed.slice(N_TRAINING)      // newest 12

        // ── 5. Build metadata ──────────────────────────────────────────────────
        const metadata: Metadata = {
            tableId,
            vectorId,
            totalFetched: allPoints.length,
            trainingSize: trainingData.length,
            validationSize: validationData.length,
            oldestDate: trainingData[0]?.date ?? "",
            newestDate: validationData.at(-1)?.date ?? "",
            fetchedAt: new Date().toISOString(),
        }

        yield* Effect.log(
            `[cansim] Done. ` +
            `Training: ${trainingData.length} obs  ` +
            `(${metadata.oldestDate} → ${trainingData.at(-1)?.date ?? ""})  |  ` +
            `Validation: ${validationData.length} obs  ` +
            `(${validationData[0]?.date ?? ""} → ${metadata.newestDate})`
        )

        return { trainingData, validationData, metadata } satisfies CansimResult
    })

// ---------------------------------------------------------------------------
// Convenience runner (escape hatch into Promise land)
// ---------------------------------------------------------------------------

/**
 * Executes `fetchCansimData` with the live HTTP client and returns a plain
 * Promise.  Useful when integrating with non-Effect codebases.
 *
 * Errors are propagated as rejected Promises.
 */
export const fetchCansimDataLive = (
    tableId: string,
    vectorId: number
): Promise<CansimResult> =>
    fetchCansimData(tableId, vectorId).pipe(
        Effect.provide(HttpClientLive),
        Effect.runPromise
    )

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------
export { HttpClient, HttpClientLive, makeTestHttpClient } from "./httpClient.js"
export type { CansimResult, DataPoint, Metadata } from "./schema.js"
export type { CansimError } from "./errors.js"
export { HttpFetchError, ApiResponseError, DataParseError } from "./errors.js"
