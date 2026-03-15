import { Schema } from "effect"

// ===========================================================================
// § Public schemas (consumed by callers)
// ===========================================================================

/**
 * A single time-series observation – the canonical unit this module produces.
 *   date  – ISO period string returned by StatCan (e.g. "2024-01" for monthly)
 *   value – numeric observation (null-valued points are already filtered out)
 */
export const DataPointSchema = Schema.Struct({
  date: Schema.String,
  value: Schema.Number,
})
export type DataPoint = Schema.Schema.Type<typeof DataPointSchema>

/**
 * Provenance information attached to every fetch result.
 */
export const MetadataSchema = Schema.Struct({
  tableId: Schema.String,
  vectorId: Schema.Number,
  totalFetched: Schema.Number,   // non-null observations returned by the API
  trainingSize: Schema.Number,   // number of observations in trainingData
  validationSize: Schema.Number, // number of observations in validationData
  oldestDate: Schema.String,     // first date in trainingData
  newestDate: Schema.String,     // last date in validationData
  fetchedAt: Schema.String,      // ISO timestamp of the request
})
export type Metadata = Schema.Schema.Type<typeof MetadataSchema>

/**
 * The value returned by fetchCansimData.
 */
export const CansimResultSchema = Schema.Struct({
  trainingData: Schema.Array(DataPointSchema),
  validationData: Schema.Array(DataPointSchema),
  metadata: MetadataSchema,
})
export type CansimResult = Schema.Schema.Type<typeof CansimResultSchema>

// ===========================================================================
// § Internal WDS API response schemas (not exported from the package)
// ===========================================================================

/**
 * A single data-point as returned by the StatCan Web Data Service.
 * Extra fields present in the JSON payload (refPer2, symbolCode, …) are
 * intentionally omitted here – Schema.Struct is lenient by default and
 * ignores unknown keys.
 */
export const WdsDataPointSchema = Schema.Struct({
  refPer: Schema.String,                        // e.g. "2024-01"
  value: Schema.NullOr(Schema.Number),          // null when suppressed/missing
  releaseTime: Schema.optional(Schema.String),  // e.g. "2024-02-09T08:30"
  statusCode: Schema.optional(Schema.Number),   // 0 = normal
})
export type WdsDataPoint = Schema.Schema.Type<typeof WdsDataPointSchema>

export const WdsVectorObjectSchema = Schema.Struct({
  vectorId: Schema.Number,
  coordinate: Schema.optional(Schema.String),
  vectorDataPoint: Schema.Array(WdsDataPointSchema),
})

/**
 * Top-level element of the WDS array response.
 * The API always returns an array, one element per requested vector.
 */
export const WdsResponseItemSchema = Schema.Struct({
  status: Schema.String,   // "SUCCESS" | error code string
  object: WdsVectorObjectSchema,
})

export const WdsApiResponseSchema = Schema.Array(WdsResponseItemSchema)
