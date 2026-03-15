import { Data } from "effect"

// ---------------------------------------------------------------------------
// Tagged error classes – each carries structured context for Effect's type
// system so callers can pattern-match on the specific failure mode.
// ---------------------------------------------------------------------------

/** Thrown when the HTTP request itself fails (network, non-2xx, etc.). */
export class HttpFetchError extends Data.TaggedError("HttpFetchError")<{
  readonly url: string
  readonly message: string
  readonly cause?: unknown
}> {}

/** Thrown when the Statistics Canada WDS API returns a non-SUCCESS status. */
export class ApiResponseError extends Data.TaggedError("ApiResponseError")<{
  readonly message: string
  readonly statusCode?: string
}> {}

/** Thrown when the raw JSON payload cannot be decoded into our schema. */
export class DataParseError extends Data.TaggedError("DataParseError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Union of all errors that fetchCansimData can produce. */
export type CansimError = HttpFetchError | ApiResponseError | DataParseError
