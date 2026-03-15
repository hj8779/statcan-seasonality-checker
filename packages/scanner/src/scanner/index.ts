/**
 * CLI entry point for the metadata pre-collection engine.
 *
 * Usage:
 *   npx tsx src/scanner/index.ts <tableId> [maxCoords] [rps]
 *
 * Arguments:
 *   tableId    – CANSIM table ID, e.g. "14-10-0287-01"  (required)
 *   maxCoords  – Maximum number of coordinates to scan   (default: 200)
 *   rps        – Requests per second for rate limiting   (default: 3)
 *
 * Prerequisites:
 *   - DATABASE_URL must be set (via .env or environment)
 *   - Tables must exist (run: npm run db:push)
 *
 * Examples:
 *   npx tsx src/scanner/index.ts 14-10-0287-01
 *   npx tsx src/scanner/index.ts 14-10-0287-01 50 2
 */

import "dotenv/config"
import { Effect } from "effect"
import { HttpClientLive } from "../cansim/httpClient.js"
import { DbLive } from "../db/client.js"
import { scanTable } from "./scanner.js"

// ─── Argument parsing ─────────────────────────────────────────────────────────

const [, , tableIdArg, maxCoordsArg, rpsArg] = process.argv

if (!tableIdArg) {
  console.error(
    "Error: tableId is required.\n" +
    "Usage:  npx tsx src/scanner/index.ts <tableId> [maxCoords] [rps]\n" +
    "Example: npx tsx src/scanner/index.ts 14-10-0287-01 200 3"
  )
  process.exit(1)
}

const tableId   = tableIdArg
const maxCoords = maxCoordsArg !== undefined ? Number(maxCoordsArg) : 200
const rps       = rpsArg       !== undefined ? Number(rpsArg)       : 3

if (isNaN(maxCoords) || maxCoords <= 0) {
  console.error(`Error: maxCoords must be a positive integer (got "${maxCoordsArg}")`)
  process.exit(1)
}
if (isNaN(rps) || rps <= 0) {
  console.error(`Error: rps must be a positive number (got "${rpsArg}")`)
  process.exit(1)
}

// ─── Program ─────────────────────────────────────────────────────────────────

console.log(
  `[scanner] Starting scan: tableId=${tableId}  maxCoords=${maxCoords}  rps=${rps}`
)

const program = scanTable(tableId, { maxCoords, rps }).pipe(
  Effect.provide(HttpClientLive),
  Effect.provide(DbLive)
)

Effect.runPromise(program)
  .then((summary) => {
    console.log(
      `\n[scanner] Scan complete!\n` +
      `  Table:     ${summary.tableId} (PID ${summary.productId})\n` +
      `  Total:     ${summary.totalCoords} coordinates scanned\n` +
      `  Succeeded: ${summary.succeeded}\n` +
      `  Failed:    ${summary.failed}`
    )
  })
  .catch((err: unknown) => {
    console.error("[scanner] Fatal error:", err)
    process.exit(1)
  })
