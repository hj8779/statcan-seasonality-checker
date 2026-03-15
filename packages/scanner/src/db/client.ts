/**
 * Effect TS database layer for Supabase / PostgreSQL via Drizzle ORM.
 *
 * Architecture:
 *
 *  Db                  – Context.Tag that declares the dependency
 *  DbLive              – Layer that reads DATABASE_URL via Effect.Config,
 *                        opens a postgres.js connection pool, and registers
 *                        automatic cleanup via Effect.addFinalizer.
 *  dbQuery(fn)         – Helper that lifts a Drizzle promise into an Effect.
 *
 * Usage (in an Effect.gen block):
 *
 *   const rows = yield* dbQuery(db =>
 *     db.select().from(vectors).where(eq(vectors.vectorId, 2062810))
 *   )
 *
 * At the program entry-point:
 *
 *   program.pipe(Effect.provide(DbLive), Effect.runPromise)
 */
import { Config, Context, Data, Effect, Layer, Redacted } from "effect"
import postgres from "postgres"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import * as schema from "./schema.js"

// ─────────────────────────────────────────────────────────────────────────────
// § 1. Error type
// ─────────────────────────────────────────────────────────────────────────────

export class DbError extends Data.TaggedError("DbError")<{
    readonly message: string
    readonly cause?: unknown
}> { }

// ─────────────────────────────────────────────────────────────────────────────
// § 2. Service interface & tag
// ─────────────────────────────────────────────────────────────────────────────

export interface DbClient {
    /** The Drizzle ORM instance, fully typed with the project schema. */
    readonly db: PostgresJsDatabase<typeof schema>
}

/**
 * Context.Tag for the database service.
 *
 * Declare it as a dependency in any Effect that needs DB access:
 *
 *   Effect.Effect<Result, DbError, Db>
 *                                  ↑
 */
export class Db extends Context.Tag("cansim/Db")<Db, DbClient>() { }

// ─────────────────────────────────────────────────────────────────────────────
// § 3. Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads database configuration from environment variables.
 *
 * Config.redacted wraps the value in Redacted<string> so it is never
 * accidentally logged or serialised – the raw string is only available
 * via Redacted.value() at the single point where the connection is opened.
 */
const DbConfig = Config.all({
    databaseUrl: Config.redacted("DATABASE_URL"),

    /**
     * Connection pool size.
     * Default: 10. Use a lower value (e.g. 5) for Supabase free tier.
     */
    poolSize: Config.integer("DB_POOL_SIZE").pipe(Config.withDefault(10)),
})

// ─────────────────────────────────────────────────────────────────────────────
// § 4. Live Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Acquires a postgres.js connection pool and a Drizzle client, then
 * registers an automatic finalizer that drains the pool when the Layer
 * scope is closed (e.g. program exit or test teardown).
 *
 * Important Supabase notes:
 *  - `prepare: false` is required when using Supabase's PgBouncer
 *    transaction pooler (default port 6543). Prepared statements are not
 *    supported in transaction pooling mode.
 *  - Use the "Session pooler" (port 5432) URL if you need prepared
 *    statements or Drizzle's `.prepare()` API.
 */
export const DbLive = Layer.scoped(
    Db,
    Effect.gen(function* () {
        const { databaseUrl, poolSize } = yield* DbConfig
        const sql = postgres(Redacted.value(databaseUrl), {
            prepare: false,
            max: poolSize,
            idle_timeout: 30,
            connect_timeout: 10,
        })
        const db = drizzle(sql, { schema })
        yield* Effect.addFinalizer(() =>
            Effect.promise(() => sql.end({ timeout: 5 })).pipe(
                Effect.tap(() => Effect.log("[db] Connection pool drained.")),
                Effect.orDie
            )
        )
        yield* Effect.log(`[db] Pool opened (max=${poolSize})`)
        return { db } satisfies DbClient
    })
)

// ─────────────────────────────────────────────────────────────────────────────
// § 5. Query helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lifts a Drizzle query (Promise) into an Effect, mapping any thrown error
 * to a typed DbError.
 *
 * @example
 * ```ts
 * import { eq } from "drizzle-orm"
 * import { vectors } from "./schema.js"
 *
 * const findVector = (vectorId: number) =>
 *   dbQuery(db =>
 *     db.select().from(vectors).where(eq(vectors.vectorId, vectorId))
 *   )
 * // Returns:  Effect<Vector[], DbError, Db>
 * ```
 */
export const dbQuery = <A>(
    fn: (db: PostgresJsDatabase<typeof schema>) => Promise<A>
): Effect.Effect<A, DbError, Db> =>
    Db.pipe(
        Effect.flatMap(({ db }) =>
            Effect.tryPromise({
                try: () => fn(db),
                catch: (cause) => new DbError({ message: "Database query failed", cause }),
            })
        )
    )

// ─────────────────────────────────────────────────────────────────────────────
// § 6. Re-usable query operations (typed convenience wrappers)
// ─────────────────────────────────────────────────────────────────────────────

import { eq, desc } from "drizzle-orm"
import type { NewVector, NewAnalysisResult } from "./schema.js"
import { vectors, analysisResults } from "./schema.js"

/** Insert or update a vector record (upsert on vectorId). */
export const upsertVector = (v: NewVector) =>
    dbQuery((db) =>
        db
            .insert(vectors)
            .values(v)
            .onConflictDoUpdate({
                target: vectors.vectorId,
                set: {
                    seriesTitle:  v.seriesTitle,
                    frequencyCode: v.frequencyCode,
                    startDate:    v.startDate,
                    endDate:      v.endDate,
                    // Scanner-populated fields: only written when provided (undefined = skip)
                    ...(v.coordinate   !== undefined ? { coordinate:   v.coordinate   } : {}),
                    ...(v.acfScore     !== undefined ? { acfScore:     v.acfScore     } : {}),
                    ...(v.acfLag       !== undefined ? { acfLag:       v.acfLag       } : {}),
                    ...(v.acfNObs      !== undefined ? { acfNObs:      v.acfNObs      } : {}),
                    ...(v.meanVal      !== undefined ? { meanVal:      v.meanVal      } : {}),
                    ...(v.variance     !== undefined ? { variance:     v.variance     } : {}),
                    ...(v.archStat     !== undefined ? { archStat:     v.archStat     } : {}),
                    ...(v.stationarity !== undefined ? { stationarity: v.stationarity } : {}),
                    ...(v.latestPts    !== undefined ? { latestPts:    v.latestPts    } : {}),
                    ...(v.scannedAt    !== undefined ? { scannedAt:    v.scannedAt    } : {}),
                    updatedAt: new Date(),
                },
            })
            .returning()
    ).pipe(Effect.map((rows) => rows[0]))

/** Insert a new analysis result row. */
export const insertAnalysis = (row: NewAnalysisResult) =>
    dbQuery((db) =>
        db.insert(analysisResults).values(row).returning()
    ).pipe(Effect.map((rows) => rows[0]))

/** Fetch the most recent analysis for a given vector. */
export const latestAnalysis = (vectorId: number) =>
    dbQuery((db) =>
        db
            .select()
            .from(analysisResults)
            .where(eq(analysisResults.vectorId, vectorId))
            .orderBy(desc(analysisResults.analysedAt))
            .limit(1)
    ).pipe(Effect.map((rows) => rows[0] ?? null))
