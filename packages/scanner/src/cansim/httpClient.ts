import { Context, Effect, Layer } from "effect"
import { HttpFetchError } from "./errors.js"

// ===========================================================================
// § Service interface
// ===========================================================================

/**
 * Minimal HTTP client abstraction.
 * Keeping the interface small (one method) makes it trivial to swap in a
 * test stub without any mocking library.
 */
export interface IHttpClient {
  /**
   * Perform a GET request and return the parsed JSON body as `unknown`.
   * Fails with HttpFetchError on network errors or non-2xx status codes.
   */
  readonly get: (url: string) => Effect.Effect<unknown, HttpFetchError>

  /**
   * Perform a POST request with a JSON body and return the parsed JSON body.
   * Fails with HttpFetchError on network errors or non-2xx status codes.
   */
  readonly post: (url: string, body: unknown) => Effect.Effect<unknown, HttpFetchError>
}

// ===========================================================================
// § Service tag  (used as the dependency token in Effects)
// ===========================================================================

/**
 * Effect Context.Tag for the HttpClient service.
 *
 * Downstream Effects declare `HttpClient` in their requirements (R channel):
 *   Effect<Result, Error, HttpClient>
 *
 * At the call-site the caller provides the desired Layer implementation:
 *   effect.pipe(Effect.provide(HttpClientLive))
 */
export class HttpClient extends Context.Tag("cansim/HttpClient")<
  HttpClient,
  IHttpClient
>() {}

// ===========================================================================
// § Live implementation  (production)
// ===========================================================================

/**
 * Concrete HttpClient backed by the WHATWG fetch() API.
 *
 * Error handling strategy:
 *  - Network / DNS failures → cause passed through as HttpFetchError
 *  - Non-2xx HTTP status   → converted to HttpFetchError with status text
 *  - JSON parse failures   → propagated via the cause field
 */
export const HttpClientLive: Layer.Layer<HttpClient> = Layer.succeed(
  HttpClient,
  {
    get: (url: string) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(url)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          return response.json() as Promise<unknown>
        },
        catch: (cause) =>
          new HttpFetchError({
            url,
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),

    post: (url: string, body: unknown) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          return response.json() as Promise<unknown>
        },
        catch: (cause) =>
          new HttpFetchError({
            url,
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
  }
)

// ===========================================================================
// § Test helper  (unit / integration tests)
// ===========================================================================

/**
 * Create a stub HttpClient from a synchronous handler function.
 *
 * Usage in tests:
 * ```ts
 * const testLayer = makeTestHttpClient((url) => {
 *   if (url.includes("getDataFromVector")) return mockWdsPayload
 *   throw new Error(`Unexpected URL: ${url}`)
 * })
 *
 * const result = await fetchCansimData("14-10-0287-01", 2062810).pipe(
 *   Effect.provide(testLayer),
 *   Effect.runPromise
 * )
 * ```
 */
export const makeTestHttpClient = (
  handler: (url: string, body?: unknown) => unknown
): Layer.Layer<HttpClient> =>
  Layer.succeed(HttpClient, {
    get: (url) =>
      Effect.try({
        try: () => handler(url),
        catch: (cause) =>
          new HttpFetchError({
            url,
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
    post: (url, body) =>
      Effect.try({
        try: () => handler(url, body),
        catch: (cause) =>
          new HttpFetchError({
            url,
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
  })
