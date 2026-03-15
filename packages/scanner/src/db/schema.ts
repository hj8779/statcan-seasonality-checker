/**
 * Drizzle ORM schema for Supabase / PostgreSQL.
 *
 * Two tables:
 *
 *  vectors          – caches Statistics Canada series metadata so we don't
 *                     need to re-call the WDS API on every analysis run.
 *
 *  analysis_results – stores the full output of analyzeSeasonality() plus
 *                     the raw training / validation data points (jsonb).
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"

// ─────────────────────────────────────────────────────────────────────────────
// § 0. scan_tasks  (task queue: browser enqueues, Node.js worker dequeues)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each row represents one vector ID waiting to be fully scanned by the
 * local Node.js worker.  The browser inserts rows (status = 'pending');
 * the worker claims them ('processing'), processes them, then marks them
 * 'done' or 'error'.
 *
 * To create in Supabase SQL editor:
 *
 *   CREATE TABLE public.scan_tasks (
 *     id         SERIAL PRIMARY KEY,
 *     vector_id  INTEGER NOT NULL,
 *     status     VARCHAR(20) NOT NULL DEFAULT 'pending',
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     started_at TIMESTAMPTZ,
 *     done_at    TIMESTAMPTZ,
 *     error_msg  TEXT
 *   );
 *   CREATE UNIQUE INDEX scan_tasks_vector_id_idx ON public.scan_tasks (vector_id);
 *   CREATE INDEX scan_tasks_status_idx ON public.scan_tasks (status, created_at);
 */
export const scanTasks = pgTable(
  "scan_tasks",
  {
    id:        serial("id").primaryKey(),
    vectorId:  integer("vector_id").notNull(),
    /** 'pending' | 'processing' | 'done' | 'error' */
    status:    varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    doneAt:    timestamp("done_at", { withTimezone: true }),
    errorMsg:  text("error_msg"),
  },
  (t) => [
    uniqueIndex("scan_tasks_vector_id_idx").on(t.vectorId),
    index("scan_tasks_status_idx").on(t.status, t.createdAt),
  ]
)

export type ScanTask    = typeof scanTasks.$inferSelect
export type NewScanTask = typeof scanTasks.$inferInsert

// ─────────────────────────────────────────────────────────────────────────────
// § 1. vectors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per Statistics Canada time-series vector.
 * Populated by calling the WDS `getSeriesInfoFromVector` endpoint.
 */
export const vectors = pgTable(
  "vectors",
  {
    id: serial("id").primaryKey(),

    /** Statistics Canada numeric vector identifier, e.g. 2062810 */
    vectorId: integer("vector_id").notNull(),

    /** Dash-separated CANSIM table ID, e.g. "14-10-0287-01" */
    tableId: varchar("table_id", { length: 20 }).notNull(),

    /** English series title returned by the WDS API (null when set by scanner) */
    seriesTitle: text("series_title"),

    /**
     * WDS frequency code:
     *   1 = Daily  |  6 = Monthly  |  9 = Quarterly  |  12 = Annual
     */
    frequencyCode: integer("frequency_code").notNull(),

    /** Earliest available period, e.g. "1976-01" */
    startDate: varchar("start_date", { length: 10 }),

    /** Most recent available period, e.g. "2024-12" */
    endDate: varchar("end_date", { length: 10 }),

    // ── Scanner-populated fields ──────────────────────────────────────────────

    /** Coordinate within the table, e.g. "1.2.1" (set by scanner) */
    coordinate: varchar("coordinate", { length: 50 }),

    /**
     * Sample autocorrelation at the seasonal lag s.
     * Null when the series has too few observations or is non-seasonal frequency.
     */
    acfScore: real("acf_score"),

    /** Seasonal lag used (12 for monthly, 4 for quarterly, null otherwise) */
    acfLag: integer("acf_lag"),

    /** Number of non-null data points used for analysis */
    acfNObs: integer("acf_n_obs"),

    /** Sample mean of the last N observations */
    meanVal: real("mean_val"),

    /** Sample variance (unbiased) of the last N observations */
    variance: real("variance"),

    /**
     * ARCH(1) LM statistic for heteroscedasticity.
     * Approx chi-squared(1); values > 3.84 suggest ARCH effects at 5% level.
     */
    archStat: real("arch_stat"),

    /**
     * Stationarity proxy: 1 - |r1|.
     * Close to 1 → likely stationary; close to 0 → strong unit root.
     */
    stationarity: real("stationarity"),

    /** Latest 5 data points (most recent first) for quick preview */
    latestPts: jsonb("latest_pts").$type<{ date: string; value: number }[]>(),

    /** Wall-clock time the scanner last updated this row */
    scannedAt: timestamp("scanned_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("vectors_vector_id_idx").on(t.vectorId),
    index("vectors_table_id_idx").on(t.tableId),
  ]
)

export type Vector    = typeof vectors.$inferSelect
export type NewVector = typeof vectors.$inferInsert

// ─────────────────────────────────────────────────────────────────────────────
// § 2. analysis_results
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of each element stored in the trainingData / validationData jsonb columns */
export type DataPoint = { date: string; value: number }

/**
 * One row per analysis run.
 * Stores the full output of `analyzeSeasonality()` + the 6-criterion
 * complexity score, so results can be reviewed without re-fetching data.
 */
export const analysisResults = pgTable(
  "analysis_results",
  {
    id: serial("id").primaryKey(),

    /** FK → vectors.vectorId (not vectors.id) for ease of lookup */
    vectorId: integer("vector_id")
      .notNull()
      .references(() => vectors.vectorId, { onDelete: "cascade" }),

    /** Wall-clock time the analysis was performed */
    analysedAt: timestamp("analysed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    // ── Detected period ──────────────────────────────────────────────────────
    /** Detected seasonal period: 12 (monthly) or 4 (quarterly) */
    frequency: integer("frequency").notNull(),

    // ── ACF seasonality test ─────────────────────────────────────────────────
    /** Sample autocorrelation at lag s  (r_s) */
    acfAtSeasonalLag: real("acf_at_seasonal_lag").notNull(),
    /** Bartlett 95 % confidence bound  (±1.96 / √n) */
    acfBound95:       real("acf_bound_95").notNull(),
    /** True when |r_s| > acfBound95 */
    acfSignificant:   boolean("acf_significant").notNull(),

    // ── F-test for seasonal means ────────────────────────────────────────────
    fStat:         real("f_stat").notNull(),
    fDfBetween:    integer("f_df_between").notNull(),   // s − 1
    fDfWithin:     integer("f_df_within").notNull(),    // n − s
    fPValue:       real("f_p_value").notNull(),
    fSignificant:  boolean("f_significant").notNull(),

    // ── Combined verdict ─────────────────────────────────────────────────────
    /** "seasonal" | "not_seasonal" | "inconclusive" */
    verdict: varchar("verdict", { length: 20 }).notNull(),

    // ── Complexity score (6-criterion rubric) ────────────────────────────────
    /** Number of criteria met (0–6) */
    complexityScore: integer("complexity_score").notNull(),
    /** "EXCELLENT (6/6)" | "GOOD (5/6)" | "MARGINAL …" | "AVOID …" */
    complexityGrade: varchar("complexity_grade", { length: 30 }).notNull(),
    /** Tentative SARIMA model string, e.g. "SARIMA(1,1,1)(1,1,1)_12" */
    modelHint: text("model_hint"),

    // ── Raw data (kept for reproducibility / plotting) ───────────────────────
    /** 100 training observations used for the analysis */
    trainingData:   jsonb("training_data").$type<DataPoint[]>(),
    /** 12 held-out validation observations */
    validationData: jsonb("validation_data").$type<DataPoint[]>(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("analysis_results_vector_id_idx").on(t.vectorId),
    index("analysis_results_analysed_at_idx").on(t.analysedAt),
  ]
)

export type AnalysisResult    = typeof analysisResults.$inferSelect
export type NewAnalysisResult = typeof analysisResults.$inferInsert

// ─────────────────────────────────────────────────────────────────────────────
// § 3. Relations (used by Drizzle's relational query API)
// ─────────────────────────────────────────────────────────────────────────────

export const vectorsRelations = relations(vectors, ({ many }) => ({
  analysisResults: many(analysisResults),
}))

export const analysisResultsRelations = relations(analysisResults, ({ one }) => ({
  vector: one(vectors, {
    fields:     [analysisResults.vectorId],
    references: [vectors.vectorId],
  }),
}))
