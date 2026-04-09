/**
 * Auto-Probe CLI — scans a contiguous range of StatCan Vector IDs.
 *
 * For each ID in [start..end] the scanner:
 *   1. Calls the WDS API and upserts metadata into the `vectors` table.
 *   2. Saves a checkpoint after every processed ID so the run can resume
 *      after a Ctrl-C or unexpected crash.
 *   3. Retries transient HTTP errors (503, network timeouts) with
 *      exponential back-off (1 s → 2 s → 4 s → 8 s → 16 s, max 5 retries).
 *   4. Silently skips vectors with too few observations (permanent failure).
 *   5. Pauses 5 s after any ID that exhausts all retries before continuing.
 *
 * Usage:
 *   npm run scan:auto -- --start=108789200 --end=108795000
 *   npm run scan:auto -- --start=108789200 --end=108795000 --rps=2
 *
 * Resume an interrupted run:
 *   npm run scan:auto -- --start=108789200 --end=108795000
 *   (the checkpoint in last_checkpoint.json is picked up automatically)
 */

import "dotenv/config"
import { Effect, Duration, Schedule } from "effect"

import { HttpClient, HttpClientLive } from "../cansim/httpClient.js"
import { HttpFetchError, ApiResponseError } from "../cansim/errors.js"
import type { CansimError } from "../cansim/errors.js"
import { Db, DbLive, type DbError } from "../db/client.js"
import { makeRateLimiter } from "./rateLimiter.js"
import { scanVectorId } from "./scanner.js"
import {
  CHECKPOINT_FILE,
  readCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
} from "./checkpoint.js"

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const parseArg = (name: string): number | undefined => {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`))
  return arg ? Number(arg.split("=")[1]) : undefined
}

const ARG_START = parseArg("start")
const ARG_END   = parseArg("end")
const RPS       = parseArg("rps") ?? 3

if (!ARG_START || !ARG_END || ARG_START > ARG_END) {
  console.error(
    "Usage: npm run scan:auto -- --start=<vectorId> --end=<vectorId> [--rps=3]"
  )
  process.exit(1)
}

// ── Retry schedule (HttpFetchError only, exponential, max 5) ─────────────────

/**
 * Schedule that retries only transient HTTP errors.
 *   - recurWhile  : skip retry entirely for non-HTTP errors (fast fail)
 *   - exponential : 1 s, 2 s, 4 s, 8 s, 16 s delays
 *   - recurs(5)   : hard cap of 5 retry attempts
 */
const retrySchedule = Schedule.recurWhile<CansimError | DbError>(
  e => e._tag === "HttpFetchError"
).pipe(
  Schedule.intersect(Schedule.exponential(Duration.seconds(1))),
  Schedule.intersect(Schedule.recurs(5))
)

// ── Per-ID outcome type ───────────────────────────────────────────────────────

type Outcome = "done" | "skipped" | "failed"

/**
 * Scan a single vector ID.
 * Returns an Outcome and never fails (all errors are handled internally).
 */
const probeOne = (
  vectorId: number
): Effect.Effect<Outcome, never, HttpClient | Db> =>
  scanVectorId(vectorId).pipe(
    Effect.retry(retrySchedule),
    Effect.as("done" as const),
    Effect.catchAll((e) => {
      if (
        e instanceof ApiResponseError &&
        e.message.startsWith("Too few observations")
      ) {
        return Effect.succeed("skipped" as const)
      }
      console.error(`[probe] v${vectorId} exhausted retries: ${String(e)}`)
      return Effect.succeed("failed" as const)
    })
  )

// ── Main program ──────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const rl = yield* makeRateLimiter(RPS)

  // Determine actual start: resume from checkpoint when available
  const checkpoint = readCheckpoint()
  const startFrom =
    checkpoint !== null
      ? Math.max(ARG_START, checkpoint + 1)
      : ARG_START
  const endAt = ARG_END

  if (checkpoint !== null && checkpoint >= ARG_START) {
    yield* Effect.log(
      `[probe] Checkpoint found: v${checkpoint} — resuming from v${startFrom}`
    )
  }

  const totalRange = endAt - ARG_START + 1
  const remaining  = endAt - startFrom + 1

  yield* Effect.log(
    `[probe] Range v${ARG_START}…v${endAt}  (${totalRange} total, ${remaining} remaining, rps=${RPS})`
  )
  yield* Effect.log(`[probe] Checkpoint file: ${CHECKPOINT_FILE}`)
  yield* Effect.log(`[probe] Ctrl-C to stop — progress is saved automatically.`)

  let done = 0, skipped = 0, failed = 0

  for (let id = startFrom; id <= endAt; id++) {
    const outcome = yield* rl.throttle(probeOne(id))

    // Always save checkpoint so a crash can resume from the next ID
    yield* saveCheckpoint(id)

    switch (outcome) {
      case "done":
        done++
        yield* Effect.log(
          `[probe] ✓ v${id}  done=${done} skip=${skipped} fail=${failed}`
        )
        break

      case "skipped":
        skipped++
        // Only log every 100 skips to avoid noise
        if (skipped % 100 === 0) {
          yield* Effect.log(`[probe] skipped=${skipped} (too few obs)`)
        }
        break

      case "failed":
        failed++
        // Pause before continuing after an ID that exhausted all retries.
        // This gives the API time to recover from a sustained outage.
        yield* Effect.log(`[probe] Pausing 5 s after failure at v${id}…`)
        yield* Effect.sleep(Duration.seconds(5))
        break
    }
  }

  // Clean up checkpoint on successful completion
  yield* clearCheckpoint()

  yield* Effect.log(
    `[probe] Finished — range=${totalRange}  done=${done}  skipped=${skipped}  failed=${failed}`
  )
})

// ── Entry point ───────────────────────────────────────────────────────────────

Effect.runPromise(
  program.pipe(
    Effect.provide(HttpClientLive),
    Effect.provide(DbLive)
  )
).catch((err: unknown) => {
  console.error("[probe] Fatal:", err)
  process.exit(1)
})
