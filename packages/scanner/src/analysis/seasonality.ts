/**
 * Seasonality detection for monthly / quarterly CANSIM time series.
 *
 * Two complementary tests:
 *
 *  1. ACF test   – significant autocorrelation at seasonal lag s signals
 *                  a periodic pattern (r_s > 1.96/√n at α = 5 %).
 *
 *  2. F-test     – one-way ANOVA on seasonal group means.  Rejects H₀
 *                  of equal means when F > F_{s−1, n−s}(0.05).
 *                  p-value computed exactly via the regularised incomplete
 *                  beta function (Lentz continued-fraction algorithm).
 *
 * All functions are pure (no Effect / I/O dependencies).
 */
import type { DataPoint } from "../cansim/schema.js"

// ─────────────────────────────────────────────────────────────────────────────
// § 1. Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Seasonal period: 12 = monthly, 4 = quarterly. */
export type Frequency = 12 | 4

export interface AcfTest {
  period: Frequency
  /** ACF values at lags 1 … 2s. */
  acf: number[]
  /** r_s : autocorrelation at the seasonal lag. */
  acfAtSeasonalLag: number
  /** Bartlett 95 % confidence bound: ±1.96 / √n. */
  bound95: number
  /** True when |r_s| > bound95. */
  isSignificant: boolean
}

export interface FTest {
  period: Frequency
  fStat: number
  /** Numerator df = s − 1. */
  dfBetween: number
  /** Denominator df = n − s. */
  dfWithin: number
  /** Exact p-value = P(F_{dfBetween, dfWithin} > fStat). */
  pValue: number
  /** True when pValue < 0.05. */
  isSignificant: boolean
  /** Grand mean for each season (length = s, index 0 = Jan or Q1). */
  seasonalMeans: number[]
}

export interface SeasonalityAnalysis {
  frequency: Frequency
  acfTest: AcfTest
  fTest: FTest
  verdict: "seasonal" | "not_seasonal" | "inconclusive"
  /** One-sentence English summary suitable for a report. */
  interpretation: string
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2. Mathematical helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Arithmetic mean. */
const mean = (xs: number[]): number =>
  xs.reduce((s, x) => s + x, 0) / xs.length

/**
 * Sample autocorrelation at lags 1 … maxLag.
 * Uses the biased denominator (divided by n) for consistency.
 */
const computeAcf = (values: number[], maxLag: number): number[] => {
  const n = values.length
  const mu = mean(values)
  const denom = values.reduce((s, x) => s + (x - mu) ** 2, 0)
  if (denom === 0) return Array(maxLag).fill(0)

  return Array.from({ length: maxLag }, (_, k) => {
    const lag = k + 1
    let num = 0
    for (let t = lag; t < n; t++) {
      num += ((values[t]! - mu) * (values[t - lag]! - mu))
    }
    return num / denom
  })
}

// ── Special functions for exact p-value ──────────────────────────────────────

/**
 * Natural log of the Gamma function.
 * Lanczos approximation (Numerical Recipes, g = 5, n = 6).
 */
const lgamma = (x: number): number => {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6,
  ]
  let y = x
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5)
  let ser = 1.000000000190015
  for (const ci of c) ser += ci / ++y
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}

/**
 * Regularised incomplete beta function I_x(a, b) via Lentz continued-fraction.
 * Relation used: I_x(a,b) = 1 − I_{1−x}(b,a) when x > (a+1)/(a+b+2).
 */
const incompleteBeta = (x: number, a: number, b: number): number => {
  if (x <= 0) return 0
  if (x >= 1) return 1
  // Use symmetry for better convergence
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a)

  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b)
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a

  // Lentz's method
  const FPMIN = 1e-30
  const EPS = 3e-7
  let c = 1, d = 1 - (a + b) * x / (a + 1)
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d

  for (let m = 1; m <= 200; m++) {
    // Even step
    let aa = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d; h *= d * c

    // Odd step
    aa = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return front * h
}

/**
 * Upper tail probability P(F_{d1, d2} > f).
 * Exact: P = I_x(d2/2, d1/2)  where  x = d2 / (d2 + d1 * f).
 */
const fPValue = (f: number, d1: number, d2: number): number => {
  if (f <= 0) return 1
  const x = d2 / (d2 + d1 * f)
  return incompleteBeta(x, d2 / 2, d1 / 2)
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3. Frequency detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer the seasonal period from the date strings.
 *
 * Strategy: count distinct sub-period (month) values across all years.
 * ≥ 10 distinct months → monthly (s = 12).
 * Otherwise           → quarterly (s = 4).
 */
export const detectFrequency = (dates: string[]): Frequency => {
  const uniqueMonths = new Set(dates.map((d) => d.split("-")[1] ?? ""))
  return uniqueMonths.size >= 10 ? 12 : 4
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4. Test functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ACF-based seasonality test.
 *
 * Significant autocorrelation at lag s (and/or 2s) is strong evidence of a
 * periodic pattern requiring a seasonal component in the SARIMA model.
 */
export const runAcfTest = (
  data: ReadonlyArray<DataPoint>,
  period?: Frequency
): AcfTest => {
  const s = period ?? detectFrequency(data.map((d) => d.date))
  const values = data.map((d) => d.value)
  const n = values.length
  const acf = computeAcf(values, 2 * s)
  const bound95 = 1.96 / Math.sqrt(n)
  const acfAtSeasonalLag = acf[s - 1] ?? 0

  return {
    period: s,
    acf,
    acfAtSeasonalLag,
    bound95,
    isSignificant: Math.abs(acfAtSeasonalLag) > bound95,
  }
}

/**
 * One-way ANOVA F-test for equal seasonal means.
 *
 * H₀: μ₁ = μ₂ = … = μ_s  (no systematic seasonal pattern)
 * H₁: at least one μⱼ differs
 *
 * Observations are grouped by season index j = (month − 1) mod s,
 * extracted from the date string "YYYY-MM".
 */
export const runFTest = (
  data: ReadonlyArray<DataPoint>,
  period?: Frequency
): FTest => {
  const s = period ?? detectFrequency(data.map((d) => d.date))
  const n = data.length

  // Assign each observation to a seasonal group 0 … s−1
  const groups: number[][] = Array.from({ length: s }, () => [])
  for (const { date, value } of data) {
    const month = parseInt(date.split("-")[1] ?? "1", 10)
    const idx = (month - 1) % s
    groups[idx]!.push(value)
  }

  const grandMean = mean(data.map((d) => d.value))
  const seasonalMeans = groups.map((g) => (g.length > 0 ? mean(g) : 0))

  // Between-group sum of squares
  const ssBetween = groups.reduce(
    (acc, g, j) => acc + g.length * (seasonalMeans[j]! - grandMean) ** 2,
    0
  )

  // Within-group sum of squares
  const ssWithin = groups.reduce(
    (acc, g, j) =>
      acc + g.reduce((a, x) => a + (x - seasonalMeans[j]!) ** 2, 0),
    0
  )

  const dfBetween = s - 1
  const dfWithin = n - s
  const fStat =
    dfWithin > 0 && ssWithin > 0
      ? (ssBetween / dfBetween) / (ssWithin / dfWithin)
      : 0
  const pValue = fPValue(fStat, dfBetween, dfWithin)

  return {
    period: s,
    fStat,
    dfBetween,
    dfWithin,
    pValue,
    isSignificant: pValue < 0.05,
    seasonalMeans,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5. Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run both tests and return a combined `SeasonalityAnalysis`.
 *
 * Verdict logic:
 *  - Both significant           → "seasonal"
 *  - Neither significant        → "not_seasonal"
 *  - Exactly one significant    → "inconclusive" (mention which)
 */
export const analyzeSeasonality = (data: ReadonlyArray<DataPoint>): SeasonalityAnalysis => {
  const frequency = detectFrequency(data.map((d) => d.date))
  const acfTest = runAcfTest(data, frequency)
  const fTest = runFTest(data, frequency)

  const acfSig = acfTest.isSignificant
  const fSig = fTest.isSignificant

  let verdict: SeasonalityAnalysis["verdict"]
  let interpretation: string

  if (acfSig && fSig) {
    verdict = "seasonal"
    interpretation =
      `Both the ACF test (r_${frequency} = ${acfTest.acfAtSeasonalLag.toFixed(3)}, ` +
      `bound = ±${acfTest.bound95.toFixed(3)}) and the F-test ` +
      `(F = ${fTest.fStat.toFixed(2)}, p = ${fTest.pValue.toFixed(4)}) ` +
      `indicate significant seasonality with period s = ${frequency}. ` +
      `A seasonal differencing operator (1 − B^${frequency}) is recommended.`
  } else if (!acfSig && !fSig) {
    verdict = "not_seasonal"
    interpretation =
      `Neither the ACF test (r_${frequency} = ${acfTest.acfAtSeasonalLag.toFixed(3)}) ` +
      `nor the F-test (p = ${fTest.pValue.toFixed(4)}) detect a systematic ` +
      `seasonal pattern at s = ${frequency}. ` +
      `An ARIMA model without seasonal differencing may suffice.`
  } else {
    verdict = "inconclusive"
    const significant = acfSig ? "ACF" : "F-test"
    const notSig = acfSig ? "F-test" : "ACF"
    interpretation =
      `Results are mixed: the ${significant} test is significant but the ${notSig} ` +
      `test is not (ACF r_${frequency} = ${acfTest.acfAtSeasonalLag.toFixed(3)}, ` +
      `F-test p = ${fTest.pValue.toFixed(4)}). ` +
      `Visual inspection of the time series and ACF plot is recommended ` +
      `before deciding on seasonal differencing.`
  }

  return { frequency, acfTest, fTest, verdict, interpretation }
}
