import { Effect, Schema } from "effect"
import { ApiResponseError, DataParseError, type CansimError } from "./errors.js"
import { HttpClient } from "./httpClient.js"
import {
  WdsApiResponseSchema,
  WdsResponseItemSchema,
  type DataPoint,
  type WdsDataPoint,
} from "./schema.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Base URL for the Statistics Canada Web Data Service (WDS) REST API v2.
 * All data/metadata endpoints are now POST requests with JSON bodies.
 * Docs: https://www.statcan.gc.ca/en/developers/wds/user-guide
 */
const WDS_BASE_URL = "https://www150.statcan.gc.ca/t1/wds/rest"

// ---------------------------------------------------------------------------
// Internal API call
// ---------------------------------------------------------------------------

/**
 * Call the WDS endpoint:
 *   POST /getDataFromVectorsAndLatestNPeriods
 *   Body: [{"vectorId": vectorId, "latestN": nPeriods}]
 *
 * Returns the decoded first element of the response array, which holds both
 * the status code and the vector data points.
 *
 * Fails with:
 *  - HttpFetchError   – network failure or non-2xx HTTP status
 *  - DataParseError   – JSON structure doesn't match the WDS schema
 *  - ApiResponseError – the API itself reports a non-SUCCESS status
 */
export const fetchWdsVector = (
  vectorId: number,
  nPeriods: number
): Effect.Effect<
  Schema.Schema.Type<typeof WdsResponseItemSchema>,
  CansimError,
  HttpClient
> =>
  Effect.gen(function* (_) {
    const client = yield* HttpClient
    const url = `${WDS_BASE_URL}/getDataFromVectorsAndLatestNPeriods`

    yield* Effect.log(`POST ${url} vectorId=${vectorId} latestN=${nPeriods}`)
    const raw = yield* client.post(url, [{ vectorId, latestN: nPeriods }])

    // Decode the raw JSON payload against our schema.
    const items = yield* Schema.decodeUnknown(WdsApiResponseSchema)(raw).pipe(
      Effect.mapError(
        (cause) =>
          new DataParseError({
            message:
              "WDS response does not match the expected schema. " +
              "The API format may have changed.",
            cause,
          })
      )
    )

    // The API returns an array; we only ever request a single vector.
    const item = items[0]
    if (item === undefined) {
      return yield* Effect.fail(
        new ApiResponseError({
          message: "WDS returned an empty array – vector may not exist.",
        })
      )
    }

    if (item.status !== "SUCCESS") {
      return yield* Effect.fail(
        new ApiResponseError({
          message: `WDS API returned a non-SUCCESS status: "${item.status}"`,
          statusCode: item.status,
        })
      )
    }

    return item
  })

// ---------------------------------------------------------------------------
// Data transformation
// ---------------------------------------------------------------------------

/**
 * Convert raw WDS data-point objects into the canonical DataPoint shape.
 *
 * Steps:
 *  1. Drop observations whose value is null (suppressed / confidential data).
 *  2. Map refPer → date, value → value.
 *  3. Sort chronologically so slice operations are predictable.
 */
export const normalizeDataPoints = (
  wdsPoints: ReadonlyArray<WdsDataPoint>
): DataPoint[] =>
  wdsPoints
    .filter((p): p is WdsDataPoint & { value: number } => p.value !== null)
    .map((p) => ({ date: p.refPer, value: p.value }))
    .sort((a, b) => a.date.localeCompare(b.date))
