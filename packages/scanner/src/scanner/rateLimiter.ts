/**
 * Leaky-bucket rate limiter using an Effect Ref for atomic slot reservation.
 *
 * Algorithm:
 *   Each call to `throttle` atomically reserves the *next available* time
 *   slot, then sleeps until that slot arrives before running the wrapped effect.
 *
 *       next_slot = max(now, last_slot + min_interval_ms)
 *
 * Because Ref.modify is atomic in the Effect runtime, multiple concurrent
 * fibers share the rate limiter without data races or double-scheduling.
 */

import { Duration, Effect, Ref } from "effect"

// ─────────────────────────────────────────────────────────────────────────────
// § 1. Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimiter {
  /**
   * Wrap an Effect so it only runs once the rate limiter grants a slot.
   * The wrapped Effect's error / requirement channels are preserved.
   */
  readonly throttle: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2. Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new RateLimiter that permits at most `rps` calls per second.
 *
 * @param rps – Maximum requests per second (e.g. 3 → one slot every 334 ms).
 *
 * @example
 * ```ts
 * const rl = yield* makeRateLimiter(3)
 * const result = yield* rl.throttle(fetchSomething())
 * ```
 */
export const makeRateLimiter = (rps: number): Effect.Effect<RateLimiter> =>
  Effect.gen(function* (_) {
    const minIntervalMs = Math.ceil(1000 / rps)

    // Holds the timestamp (ms since epoch) of the most recently reserved slot.
    // Initialised to 0 so the first call is always immediate.
    const lastSlot = yield* Ref.make(0)

    const throttle = <A, E, R>(
      effect: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E, R> =>
      Effect.gen(function* (_) {
        // Atomically claim the next slot; returns the scheduled execution time.
        const scheduledAt = yield* Ref.modify(lastSlot, (last) => {
          const now = Date.now()
          const next = Math.max(now, last + minIntervalMs)
          return [next, next] as const
        })

        // Sleep until our reserved slot (no-op if already past).
        const delay = scheduledAt - Date.now()
        if (delay > 0) {
          yield* Effect.sleep(Duration.millis(delay))
        }

        return yield* effect
      })

    return { throttle } satisfies RateLimiter
  })
