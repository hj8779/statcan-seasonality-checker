/**
 * Queue Worker — reads pending tasks from `scan_tasks`, scans each vector via
 * the StatCan WDS API (no CORS restriction in Node.js), and writes results to
 * the `vectors` table in Supabase.
 *
 * Architecture (browser ↔ DB ↔ worker):
 *
 *   Browser  ──→  INSERT INTO scan_tasks (vector_id, status='pending')
 *   Worker   ──→  UPDATE … SET status='processing'
 *                 fetch StatCan WDS (no CORS!)
 *                 UPSERT INTO vectors
 *                 UPDATE … SET status='done'
 *   Browser  ──→  reads `vectors` / `scan_tasks` to show live results
 *
 * Usage:
 *   npx tsx src/scanner/worker.ts          # default 3 req/s, batch 5
 *   npx tsx src/scanner/worker.ts 5 10     # rps=5, batchSize=10
 *   RPS=2 BATCH=3 npx tsx src/scanner/worker.ts
 *
 * Prerequisites:
 *   DATABASE_URL in .env (same as the main scanner)
 *   `scan_tasks` table created — run: npm run db:push
 *   OR paste the SQL from src/db/schema.ts into the Supabase SQL editor.
 */

import "dotenv/config"
import { Effect, Duration, Schedule } from "effect"
import { asc, eq, inArray }          from "drizzle-orm"

import { HttpClientLive }            from "../cansim/httpClient.js"
import { Db, DbLive, dbQuery }       from "../db/client.js"
import { scanTasks }                 from "../db/schema.js"
import { scanVectorId }              from "./scanner.js"

// ── Configuration ─────────────────────────────────────────────────────────────

const RPS        = Number(process.env["RPS"]   ?? process.argv[2] ?? 3)
const BATCH_SIZE = Number(process.env["BATCH"] ?? process.argv[3] ?? 5)
const POLL_SECS  = 3    // seconds between polls when queue is empty

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Claim up to BATCH_SIZE pending tasks and flip them to 'processing'. */
const claimTasks = dbQuery(async (db) => {
  const pending = await db
    .select({ id: scanTasks.id, vectorId: scanTasks.vectorId })
    .from(scanTasks)
    .where(eq(scanTasks.status, "pending"))
    .orderBy(asc(scanTasks.createdAt))
    .limit(BATCH_SIZE)

  if (pending.length === 0) return []

  await db
    .update(scanTasks)
    .set({ status: "processing", startedAt: new Date() })
    .where(inArray(scanTasks.id, pending.map(r => r.id)))

  return pending
})

const markDone = (id: number) =>
  dbQuery((db) =>
    db.update(scanTasks)
      .set({ status: "done", doneAt: new Date() })
      .where(eq(scanTasks.id, id))
  )

const markError = (id: number, msg: string) =>
  dbQuery((db) =>
    db.update(scanTasks)
      .set({ status: "error", doneAt: new Date(), errorMsg: msg.slice(0, 400) })
      .where(eq(scanTasks.id, id))
  )

// ── Poll cycle ────────────────────────────────────────────────────────────────

/**
 * One poll cycle: claim pending tasks, scan each one, mark done/error.
 * Returns the number of tasks processed.
 */
const pollCycle = Effect.gen(function* () {
  const tasks = yield* claimTasks.pipe(
    Effect.catchAll((e) => {
      console.error("[worker] DB error claiming tasks:", String(e))
      return Effect.succeed([] as { id: number; vectorId: number }[])
    })
  )

  if (tasks.length === 0) return 0

  yield* Effect.log(`[worker] Claimed ${tasks.length} task(s)`)

  // Rate-limit delay between scans  (1 / rps seconds)
  const delayMs = Math.round(1000 / Math.max(0.1, RPS))

  for (const task of tasks) {
    yield* scanVectorId(task.vectorId).pipe(
      Effect.andThen(markDone(task.id)),
      Effect.catchAll((e) => {
        const msg = String(e)
        console.error(`[worker] v${task.vectorId} failed: ${msg}`)
        return markError(task.id, msg)
      })
    )
    if (tasks.indexOf(task) < tasks.length - 1) {
      yield* Effect.sleep(Duration.millis(delayMs))
    }
  }

  return tasks.length
})

// ── Main loop ─────────────────────────────────────────────────────────────────

const program = Effect.repeat(
  pollCycle.pipe(
    Effect.tap((n) =>
      n === 0
        ? Effect.log(`[worker] Queue empty — waiting ${POLL_SECS}s…`)
        : Effect.log(`[worker] Processed ${n} task(s)`)
    ),
    Effect.catchAll((e) => {
      console.error("[worker] Unexpected error:", String(e))
      return Effect.succeed(0)
    })
  ),
  Schedule.addDelay(Schedule.forever, () => Duration.seconds(POLL_SECS))
).pipe(
  Effect.provide(HttpClientLive),
  Effect.provide(DbLive)
)

console.log(
  `[worker] Queue worker started — rps=${RPS}, batch=${BATCH_SIZE}, poll=${POLL_SECS}s`
)
console.log("[worker] Ctrl-C to stop.")

Effect.runPromise(program).catch((err: unknown) => {
  console.error("[worker] Fatal:", err)
  process.exit(1)
})
