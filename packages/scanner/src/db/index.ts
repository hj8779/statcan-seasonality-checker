// Public surface of the db module.
// Import from "./db/index.js" rather than individual files.

export {
  Db,
  DbLive,
  DbError,
  dbQuery,
  upsertVector,
  insertAnalysis,
  latestAnalysis,
} from "./client.js"

export type { DbClient } from "./client.js"

export {
  vectors,
  analysisResults,
  vectorsRelations,
  analysisResultsRelations,
} from "./schema.js"

export type {
  Vector,
  NewVector,
  AnalysisResult,
  NewAnalysisResult,
  DataPoint,
} from "./schema.js"
