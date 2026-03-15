import type { DataPoint, FullAnalysis } from '../types'

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

export function computeAcf(values: number[], maxLag: number): number[] {
  const n = values.length
  const mu = mean(values)
  const denom = values.reduce((s, x) => s + (x - mu) ** 2, 0)
  if (denom === 0) return Array(maxLag).fill(0)
  return Array.from({ length: maxLag }, (_, k) => {
    let num = 0
    for (let t = k + 1; t < n; t++) num += (values[t] - mu) * (values[t - k - 1] - mu)
    return num / denom
  })
}

export function computePacf(acfArr: number[]): number[] {
  const n = acfArr.length
  if (n === 0) return []
  const getR = (j: number): number => (j === 0 ? 1 : (acfArr[j - 1] ?? 0))
  const pacf = [acfArr[0]]
  let phi = [acfArr[0]]
  for (let k = 1; k < n; k++) {
    let num = getR(k + 1)
    let den = 1
    for (let j = 1; j <= k; j++) {
      num -= phi[j - 1] * getR(k + 1 - j)
      den -= phi[j - 1] * getR(j)
    }
    const pk = Math.abs(den) > 1e-10 ? num / den : 0
    phi = [...phi.map((v, j) => v - pk * (phi[k - 1 - j] ?? 0)), pk]
    pacf.push(pk)
  }
  return pacf
}

export function lgamma(x: number): number {
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

export function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  if (x > (a + 1) / (a + b + 2)) return 1 - ibeta(1 - x, b, a)
  const lnB = lgamma(a) + lgamma(b) - lgamma(a + b)
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnB) / a
  const FPMIN = 1e-30
  const EPS = 3e-7
  let c = 1
  let d = 1 - (a + b) * x / (a + 1)
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    let aa = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return front * h
}

export function fPValue(f: number, d1: number, d2: number): number {
  if (f <= 0) return 1
  return ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2)
}

export function detectFreq(dates: string[]): number {
  const months = new Set(dates.map(d => d.split('-')[1] ?? ''))
  return months.size >= 10 ? 12 : 4
}

export function fullAnalyze(trainingData: DataPoint[]): FullAnalysis {
  const s = detectFreq(trainingData.map(d => d.date))
  const values = trainingData.map(d => d.value)
  const n = values.length
  const bound = 1.96 / Math.sqrt(n)
  const acf = computeAcf(values, 2 * s)
  const pacf = computePacf(acf)
  const acfAtS = acf[s - 1] ?? 0
  const acfSig = Math.abs(acfAtS) > bound

  const groups: number[][] = Array.from({ length: s }, () => [])
  for (const { date, value } of trainingData) {
    const m = parseInt((date.split('-')[1] ?? '1'), 10)
    groups[(m - 1) % s].push(value)
  }
  const grandMean = mean(values)
  const seasonalMeans = groups.map(g => (g.length ? mean(g) : 0))
  const ssBw = groups.reduce((a, g, j) => a + g.length * (seasonalMeans[j] - grandMean) ** 2, 0)
  const ssWi = groups.reduce((a, g, j) => a + g.reduce((b, x) => b + (x - seasonalMeans[j]) ** 2, 0), 0)
  const dfB = s - 1
  const dfW = n - s
  const fStat = dfW > 0 && ssWi > 0 ? (ssBw / dfB) / (ssWi / dfW) : 0
  const pValue = fPValue(fStat, dfB, dfW)
  const fSig = pValue < 0.05
  const verdict: 'seasonal' | 'not_seasonal' | 'inconclusive' =
    acfSig && fSig ? 'seasonal' : !acfSig && !fSig ? 'not_seasonal' : 'inconclusive'

  const isSeasonalLag = (i: number) => i === s - 1 || i === 2 * s - 1
  const sigAcfNS = acf.slice(0, 2 * s).filter((_, i) => !isSeasonalLag(i) && Math.abs(acf[i]) > bound).length
  const sigPacfNS = acf.slice(0, 2 * s).filter((_, i) => !isSeasonalLag(i) && Math.abs(pacf[i] ?? 0) > bound).length
  const acfAt2S = Math.abs(acf[2 * s - 1] ?? 0)
  const pacfAtS = Math.abs(pacf[s - 1] ?? 0)
  const mixed = sigAcfNS > 1 && sigPacfNS > 1
  const r1 = Math.abs(acf[0] ?? 0)
  const ss_ratio = bound > 0 ? Math.abs(acfAtS) / bound : 0

  const crit = [
    {
      name: 'Strong seasonal pattern',
      pass: ss_ratio > 3,
      value: `ACF(s) = ${Math.abs(acfAtS).toFixed(3)}  (${ss_ratio.toFixed(1)}× bound)`,
    },
    {
      name: 'Non-stationarity (needs d≥1)',
      pass: r1 > 0.6,
      value: `r₁ = ${r1.toFixed(3)}`,
    },
    {
      name: 'Complex AR structure (PACF ≥2 NS)',
      pass: sigPacfNS > 1,
      value: `${sigPacfNS} sig non-seasonal PACF lags`,
    },
    {
      name: 'Complex MA structure (ACF ≥2 NS)',
      pass: sigAcfNS > 1,
      value: `${sigAcfNS} sig non-seasonal ACF lags`,
    },
    {
      name: 'Mixed ARMA (both ACF & PACF tail)',
      pass: mixed,
      value: mixed ? 'Both tail off' : 'One cuts off sharply',
    },
    {
      name: 'Seasonal ARMA component (P or Q≥1)',
      pass: acfAt2S > bound || pacfAtS > bound,
      value: `ACF(2s)=${acfAt2S.toFixed(3)}  PACF(s)=${pacfAtS.toFixed(3)}`,
    },
  ]
  const score = crit.filter(c => c.pass).length
  const GRADES = [
    'AVOID (0/6)', 'AVOID (1/6)', 'MARGINAL (2/6)', 'MARGINAL (3/6)',
    'GOOD (4/6)', 'EXCELLENT (5/6)', 'EXCELLENT (6/6)',
  ]
  const GCOLORS = ['#991b1b', '#b91c1c', '#92400e', '#78350f', '#1e3a8a', '#166534', '#14532d']
  const grade = GRADES[score] ?? String(score)
  const gradeColor = GCOLORS[score] ?? '#374151'

  const p = sigPacfNS > 0 ? Math.min(sigPacfNS, 2) : 1
  const q = sigAcfNS > 0 ? Math.min(sigAcfNS, 2) : 1
  const P = pacfAtS > bound ? 1 : 0
  const Q = Math.abs(acfAtS) > bound ? 1 : 0
  const d = r1 > 0.5 ? 1 : 0
  const modelHint = `Tentative model: SARIMA(${p},${d},${q})(${P},1,${Q})_${s} — verify with ACF/PACF diagnostics`

  return { s, acf, pacf, bound, acfAtS, acfSig, fStat, pValue, fSig, verdict, seasonalMeans, score, grade, gradeColor, crit, modelHint }
}
