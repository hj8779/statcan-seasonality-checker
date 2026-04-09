/**
 * File-based checkpoint for the auto-probe scanner.
 *
 * Writes { vectorId, savedAt } to last_checkpoint.json in the working
 * directory so a Ctrl-C or crash can be resumed from the last processed ID.
 */

import { Effect } from "effect"
import fs from "node:fs"
import path from "node:path"

export const CHECKPOINT_FILE = path.resolve("last_checkpoint.json")

/** Read the last saved vector ID, or null if none exists. */
export const readCheckpoint = (): number | null => {
  try {
    const raw = fs.readFileSync(CHECKPOINT_FILE, "utf-8")
    const data = JSON.parse(raw) as { vectorId?: unknown }
    return typeof data.vectorId === "number" ? data.vectorId : null
  } catch {
    return null
  }
}

/** Persist the current vector ID so the scan can resume after a crash. */
export const saveCheckpoint = (vectorId: number): Effect.Effect<void> =>
  Effect.sync(() => {
    fs.writeFileSync(
      CHECKPOINT_FILE,
      JSON.stringify({ vectorId, savedAt: new Date().toISOString() })
    )
  })

/** Remove the checkpoint file after a clean run. */
export const clearCheckpoint = (): Effect.Effect<void> =>
  Effect.sync(() => {
    try { fs.unlinkSync(CHECKPOINT_FILE) } catch { /* already gone — ok */ }
  })
