/**
 * Metadata pre-collection engine for Statistics Canada WDS tables.
 *
 * Given a CANSIM table ID (e.g. "14-10-0287-01") this module:
 *
 *  1. Fetches cube metadata to discover all dimensions and their members.
 *  2. Generates a cartesian product of top-level member IDs → coordinate strings.
 *  3. For each coordinate (rate-limited): fetches 200 data points, computes
 *     ACF, mean, variance, stationarity proxy, ARCH LM stat, and upserts into DB.
 *
 * Rate limiting defaults to 3 req/s, well within StatCan's undocumented limit.
 *
 * WDS API v2: All endpoints are POST requests with JSON bodies.
 *   Base: https://www150.statcan.gc.ca/t1/wds/rest
 */

import { Effect, Schema } from "effect"
import {
  ApiResponseError,
  DataParseError,
  type CansimError,
} from "../cansim/errors.js"
import { HttpClient } from "../cansim/httpClient.js"
import { WdsApiResponseSchema, type WdsDataPoint } from "../cansim/schema.js"
import { Db, DbError, upsertVector } from "../db/client.js"
import { makeRateLimiter } from "./rateLimiter.js"

// ─────────────────────────────────────────────────────────────────────────────
// § 1. Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

const WDS_BASE = "https://www150.statcan.gc.ca/t1/wds/rest"

/**
 * Convert a dash-separated CANSIM table ID to a numeric WDS product ID.
 * "14-10-0287-01" → 14100287  (first three segments joined, last "-NN" dropped)
 */
const tableIdToProductId = (tableId: string): number => {
  const parts = tableId.split("-")
  const numStr = parts.slice(0, 3).join("") // "14" + "10" + "0287" = "14100287"
  return parseInt(numStr, 10)
}

/**
 * Map WDS frequency codes to a seasonal period s.
 *
 *  6 = Monthly   → s = 12
 *  9 = Quarterly → s = 4
 *  anything else → null (e.g. daily, annual – ACF not computed)
 */
const frequencyToS = (code: number): 12 | 4 | null => {
  if (code === 6) return 12
  if (code === 9) return 4
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2. getCubeMetadata schemas
// ─────────────────────────────────────────────────────────────────────────────

const WdsMemberSchema = Schema.Struct({
  memberId:       Schema.Number,
  parentMemberId: Schema.Number,
  memberNameEn:   Schema.optional(Schema.String),
})

const WdsDimensionSchema = Schema.Struct({
  dimensionPositionId: Schema.Number,
  member:              Schema.Array(WdsMemberSchema),
})

const WdsCubeObjectSchema = Schema.Struct({
  productId:     Schema.Number,
  frequencyCode: Schema.Number,
  cubeTitleEn:   Schema.optional(Schema.String),
  cubeStartDate: Schema.optional(Schema.String),
  cubeEndDate:   Schema.optional(Schema.String),
  dimension:     Schema.Array(WdsDimensionSchema),
})

const WdsCubeMetadataResponseSchema = Schema.Array(
  Schema.Struct({
    status: Schema.String,
    object: WdsCubeObjectSchema,
  })
)

type CubeInfo = Schema.Schema.Type<typeof WdsCubeObjectSchema>

// ─────────────────────────────────────────────────────────────────────────────
// § 3. Statistical helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Sample autocorrelation at a single lag. Returns 0 when too few observations. */
const acfAtLag = (values: readonly number[], lag: number): number => {
  const n = values.length
  if (n <= lag || lag <= 0) return 0
  const avg = values.reduce((s, v) => s + v, 0) / n
  let denom = 0, numer = 0
  for (let t = 0; t < n; t++) {
    const dev = (values[t]! - avg)
    denom += dev * dev
    if (t >= lag) numer += dev * (values[t - lag]! - avg)
  }
  return denom === 0 ? 0 : numer / denom
}

/** Sample mean. */
const sampleMean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length

/** Sample variance (unbiased). */
const sampleVariance = (values: readonly number[]): number => {
  const n = values.length
  if (n < 2) return 0
  const mu = sampleMean(values)
  return values.reduce((s, v) => s + (v - mu) ** 2, 0) / (n - 1)
}

/**
 * ARCH(1) LM statistic for heteroscedasticity.
 * Returns (n-1) * R² of regressing squared residuals on their lag-1.
 * Under H0 (no ARCH effect) this follows chi-squared(1).
 * Large values (> 3.84) suggest ARCH effects at 5% significance.
 */
const archLmStat = (values: readonly number[]): number => {
  const n = values.length
  if (n < 4) return 0
  const mu = sampleMean(values)
  const residSq = values.map(v => (v - mu) ** 2)
  const y = residSq.slice(1)
  const x = residSq.slice(0, -1)
  const my = sampleMean(y), mx = sampleMean(x)
  let sxy = 0, sxx = 0
  for (let i = 0; i < y.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my)
    sxx += (x[i]! - mx) ** 2
  }
  if (sxx === 0) return 0
  const beta = sxy / sxx
  const alpha = my - beta * mx
  const ssRes = y.reduce((s, yi, i) => s + (yi - (alpha + beta * x[i]!)) ** 2, 0)
  const ssTot = y.reduce((s, yi) => s + (yi - my) ** 2, 0)
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0
  return (y.length) * r2
}

/**
 * Stationarity proxy: 1 - |r1|.
 * r1 > 0.9 → near unit root (non-stationary).
 * Returns a score in [0, 1]: 1 = clearly stationary, 0 = strong unit root.
 */
const stationarityProxy = (values: readonly number[]): number =>
  1 - Math.abs(acfAtLag(values, 1))

// ─────────────────────────────────────────────────────────────────────────────
// § 4. Coordinate generation
// ─────────────────────────────────────────────────────────────────────────────

/** Cartesian product of arrays of numbers */
const cartesian = (
  arrays: readonly (readonly number[])[]
): readonly (readonly number[])[] => {
  if (arrays.length === 0) return [[]]
  const [first, ...rest] = arrays
  const restProduct = cartesian(rest)
  return (first ?? []).flatMap((x) => restProduct.map((r) => [x, ...r]))
}

/**
 * Build all coordinate strings from cube metadata.
 *
 * Strategy: use leaf members (members that are not the parent of any other
 * member in the same dimension).  This handles both flat hierarchies (where
 * all members have parentMemberId === 0) and deep hierarchies (where
 * top-level members act only as grouping labels, as in table 37-10-0169-01).
 * Falls back to all members if no leaves are detected.
 */
const generateCoordinates = (
  dimensions: CubeInfo["dimension"]
): readonly string[] => {
  const memberIdsByDim = dimensions.map((dim) => {
    const parentIds = new Set(dim.member.map((m) => m.parentMemberId))
    const leaves = dim.member.filter((m) => !parentIds.has(m.memberId))
    // Fall back to all members if leaf detection yields nothing
    const selected = leaves.length > 0 ? leaves : dim.member
    return selected.map((m) => m.memberId)
  })
  return cartesian(memberIdsByDim).map((ids) => ids.join("."))
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5. WDS API calls (POST-based, WDS REST v2)
// ─────────────────────────────────────────────────────────────────────────────

const fetchCubeMetadata = (
  productId: number
): Effect.Effect<CubeInfo, CansimError, HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient
    const url = `${WDS_BASE}/getCubeMetadata`
    yield* Effect.log(`POST ${url} productId=${productId}`)
    const raw = yield* client.post(url, [{ productId }])

    const items = yield* Schema.decodeUnknown(WdsCubeMetadataResponseSchema)(raw).pipe(
      Effect.mapError(
        (cause) =>
          new DataParseError({
            message: "getCubeMetadata response does not match expected schema.",
            cause,
          })
      )
    )

    const item = items[0]
    if (item === undefined) {
      return yield* Effect.fail(
        new ApiResponseError({ message: "getCubeMetadata returned an empty array." })
      )
    }
    if (item.status !== "SUCCESS") {
      return yield* Effect.fail(
        new ApiResponseError({
          message: `getCubeMetadata non-SUCCESS status: "${item.status}"`,
          statusCode: item.status,
        })
      )
    }
    return item.object
  })

const fetchCoordData = (
  productId: number,
  coord:     string,
  nPeriods:  number
): Effect.Effect<
  { vectorId: number; values: readonly number[]; coordinate: string; dataPoints: readonly { date: string; value: number }[] },
  CansimError,
  HttpClient
> =>
  Effect.gen(function* () {
    const client = yield* HttpClient
    const url = `${WDS_BASE}/getDataFromCubePidCoordAndLatestNPeriods`
    const raw = yield* client.post(url, [{ productId, coordinate: coord, latestN: nPeriods }])

    const items = yield* Schema.decodeUnknown(WdsApiResponseSchema)(raw).pipe(
      Effect.mapError(
        (cause) =>
          new DataParseError({
            message: "getDataFromCubePidCoordAndLatestNPeriods parse error.",
            cause,
          })
      )
    )

    const item = items[0]
    if (item === undefined) {
      return yield* Effect.fail(
        new ApiResponseError({ message: `No data returned for coord ${coord}.` })
      )
    }
    if (item.status !== "SUCCESS") {
      return yield* Effect.fail(
        new ApiResponseError({
          message: `Coord ${coord} error: "${item.status}"`,
          statusCode: item.status,
        })
      )
    }

    const dataPoints: { date: string; value: number }[] =
      item.object.vectorDataPoint
        .filter((p: WdsDataPoint): p is WdsDataPoint & { value: number } => p.value !== null)
        .map((p: WdsDataPoint & { value: number }) => ({ date: p.refPer, value: p.value }))
        .sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date))

    return {
      vectorId:   item.object.vectorId,
      values:     dataPoints.map(p => p.value),
      coordinate: item.object.coordinate ?? coord,
      dataPoints,
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// § 6. Per-coordinate scan
// ─────────────────────────────────────────────────────────────────────────────

const scanCoordinate = (
  tableId:       string,
  productId:     number,
  coord:         string,
  s:             12 | 4 | null,
  frequencyCode: number
): Effect.Effect<void, CansimError | DbError, HttpClient | Db> =>
  Effect.gen(function* () {
    const { vectorId, values, coordinate, dataPoints } =
      yield* fetchCoordData(productId, coord, 200)

    const acfScore    = s !== null && values.length > s ? acfAtLag(values, s) : null
    const meanVal     = values.length > 0 ? sampleMean(values) : null
    const variance    = values.length > 1 ? sampleVariance(values) : null
    const archStat    = values.length > 3 ? archLmStat(values) : null
    const stationarity = values.length > 1 ? stationarityProxy(values) : null
    const latestPts   = dataPoints.slice(-5).reverse()
    const now         = new Date()

    yield* upsertVector({
      vectorId,
      tableId,
      seriesTitle:   null,
      frequencyCode,
      coordinate,
      acfScore,
      acfLag:        s,
      acfNObs:       values.length,
      meanVal,
      variance,
      archStat,
      stationarity,
      latestPts,
      scannedAt:     now,
    })

    yield* Effect.log(
      `[scanner] ${coord} → v${vectorId}  ` +
      `ACF(${s ?? "?"})=${acfScore !== null ? acfScore.toFixed(3) : "n/a"}  ` +
      `mean=${meanVal !== null ? meanVal.toFixed(2) : "n/a"}  ` +
      `(${values.length} obs)`
    )
  })

// ─────────────────────────────────────────────────────────────────────────────
// § 7. Public: scanVectorId  (used by the queue worker)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan a single vector by ID: fetches series info + 200 data points,
 * computes statistical metadata, and upserts to the `vectors` table.
 *
 * Unlike `scanCoordinate`, this function uses the vector-based WDS endpoints
 * (`getSeriesInfoFromVector` + `getDataFromVectorsAndLatestNPeriods`) which
 * return CORS headers and can also be called from the browser.  The worker
 * uses this so it can process tasks queued by the browser.
 */
export const scanVectorId = (
  vectorId: number
): Effect.Effect<void, CansimError | DbError, HttpClient | Db> =>
  Effect.gen(function* () {
    const client = yield* HttpClient

    // Fetch series info + data in parallel
    const [infoRaw, dataRaw] = yield* Effect.all([
      client.post(`${WDS_BASE}/getSeriesInfoFromVector`,
        [{ vectorId }]),
      client.post(`${WDS_BASE}/getDataFromVectorsAndLatestNPeriods`,
        [{ vectorId, latestN: 200 }]),
    ])

    // Validate info response
    const infoItems = infoRaw as Array<{ status: string; object: Record<string, unknown> }>
    const infoItem  = infoItems[0]
    if (infoItem?.status !== "SUCCESS") {
      return yield* Effect.fail(
        new ApiResponseError({ message: `getSeriesInfoFromVector failed: ${infoItem?.status ?? "empty"}` })
      )
    }
    const info = infoItem.object

    // Validate data response
    const dataItems = dataRaw as Array<{ status: string; object: Record<string, unknown> }>
    const dataItem  = dataItems[0]
    if (dataItem?.status !== "SUCCESS") {
      return yield* Effect.fail(
        new ApiResponseError({ message: `getDataFromVectorsAndLatestNPeriods failed: ${dataItem?.status ?? "empty"}` })
      )
    }

    // Parse data points
    const rawPts = (dataItem.object.vectorDataPoint as WdsDataPoint[] | undefined) ?? []
    const dataPoints = rawPts
      .filter((p): p is WdsDataPoint & { value: number } => p.value !== null)
      .map(p => ({ date: p.refPer, value: p.value }))
      .sort((a, b) => a.date.localeCompare(b.date))

    if (dataPoints.length < 12) {
      return yield* Effect.fail(
        new ApiResponseError({ message: `Too few observations: ${dataPoints.length}` })
      )
    }

    const values       = dataPoints.map(p => p.value)
    const freqCode     = info.frequencyCode as number
    const s            = frequencyToS(freqCode)
    const acfScore     = s !== null && values.length > s ? acfAtLag(values, s) : null
    const latestPts    = dataPoints.slice(-5).reverse()

    yield* upsertVector({
      vectorId,
      tableId:       String((info.productId ?? (dataItem.object.productId as unknown)) ?? ""),
      seriesTitle:   (info.SeriesTitleEn as string | undefined) ?? null,
      frequencyCode: freqCode,
      startDate:     (info.startDate as string | undefined)?.slice(0, 7) ?? null,
      endDate:       (info.endDate   as string | undefined)?.slice(0, 7) ?? null,
      acfScore,
      acfLag:        s,
      acfNObs:       values.length,
      meanVal:       sampleMean(values),
      variance:      sampleVariance(values),
      archStat:      archLmStat(values),
      stationarity:  stationarityProxy(values),
      latestPts,
      scannedAt:     new Date(),
    })

    yield* Effect.log(
      `[worker] v${vectorId} ` +
      `ACF(${s ?? "?"})=${acfScore !== null ? acfScore.toFixed(3) : "n/a"} ` +
      `(${values.length} obs)`
    )
  })

// ─────────────────────────────────────────────────────────────────────────────
// § 8. Public: scanTable
// ─────────────────────────────────────────────────────────────────────────────

export interface ScanSummary {
  readonly tableId:     string
  readonly productId:   number
  readonly totalCoords: number
  readonly succeeded:   number
  readonly failed:      number
}

/**
 * Scan an entire CANSIM table, saving ACF-scored vector metadata to the DB.
 *
 * @param tableId   – Dash-separated table ID, e.g. "14-10-0287-01"
 * @param opts.maxCoords – Cap on coordinates scanned (default 200)
 * @param opts.rps       – Requests per second for rate limiting (default 3)
 */
export const scanTable = (
  tableId: string,
  opts: { maxCoords?: number; rps?: number } = {}
): Effect.Effect<ScanSummary, CansimError | DbError, HttpClient | Db> =>
  Effect.gen(function* () {
    const { maxCoords = 200, rps = 3 } = opts
    const rl        = yield* makeRateLimiter(rps)
    const productId = tableIdToProductId(tableId)

    // ── 1. Cube metadata ───────────────────────────────────────────────────
    yield* Effect.log(`[scanner] Fetching cube metadata for PID ${productId}…`)
    const cubeInfo = yield* rl.throttle(fetchCubeMetadata(productId))
    const s        = frequencyToS(cubeInfo.frequencyCode)

    // ── 2. Coordinate list ─────────────────────────────────────────────────
    const allCoords = generateCoordinates(cubeInfo.dimension)
    const coords    = allCoords.slice(0, maxCoords)

    yield* Effect.log(
      `[scanner] Table ${tableId}: ` +
      `frequencyCode=${cubeInfo.frequencyCode} (s=${s ?? "n/a"}), ` +
      `${allCoords.length} total coords, scanning first ${coords.length}`
    )

    // ── 3. Scan each coordinate with rate limiting ─────────────────────────
    // Use plain mutable counters (safe because concurrency: 1 → sequential).
    let succeeded = 0
    let failed    = 0

    yield* Effect.forEach(
      coords,
      (coord) =>
        rl.throttle(
          scanCoordinate(tableId, productId, coord, s, cubeInfo.frequencyCode).pipe(
            Effect.tap(() => Effect.sync(() => { succeeded++ })),
            Effect.catchAll((e) =>
              Effect.sync(() => { failed++ }).pipe(
                Effect.andThen(
                  Effect.log(`[scanner] Skip ${coord}: ${String(e)}`)
                )
              )
            )
          )
        ),
      { concurrency: 1, discard: true }
    )

    yield* Effect.log(
      `[scanner] Done — succeeded=${succeeded}, failed=${failed}, total=${coords.length}`
    )

    return { tableId, productId, totalCoords: coords.length, succeeded, failed }
  })
