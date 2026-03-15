import React from 'react'
import type { VectorWithAnalysis, AnalysisResult } from '../../types'

interface Props {
  v: VectorWithAnalysis
  a: AnalysisResult | null
}

export default function CriteriaGrid({ v, a }: Props) {
  if (!a) {
    return <p style={{ fontSize: '.82rem', color: '#94a3b8' }}>No analysis data available.</p>
  }

  const bound = a.acf_bound_95 ?? 0
  const acfAtS = Math.abs(a.acf_at_seasonal_lag ?? 0)
  const ss = bound > 0 ? acfAtS / bound : 0
  const r1 = v.acf_score != null ? Math.abs(v.acf_score) : null

  const crit = [
    {
      name: 'Strong seasonal pattern',
      pass: ss > 3,
      value: `ACF(s) = ${acfAtS.toFixed(3)}  (${ss.toFixed(1)}× bound)`,
    },
    {
      name: 'Non-stationarity (needs differencing)',
      pass: r1 !== null && r1 > 0.6,
      value: r1 !== null ? `r₁ = ${r1.toFixed(3)}` : 'N/A',
    },
    {
      name: 'Stationarity proxy',
      pass: v.stationarity !== null && v.stationarity < 0.5,
      value: v.stationarity !== null ? `1 − |r₁| = ${v.stationarity.toFixed(3)}` : 'N/A',
    },
    {
      name: 'ACF significant at seasonal lag',
      pass: a.acf_significant === true,
      value: a.acf_significant ? 'Yes' : 'No',
    },
    {
      name: 'F-test: seasonal means differ',
      pass: a.f_significant === true,
      value: a.f_significant
        ? `F = ${a.f_stat?.toFixed(2)}, p = ${(a.f_p_value ?? 0) < 0.001 ? '< 0.001' : a.f_p_value?.toFixed(3)}`
        : `F = ${a.f_stat?.toFixed(2)}, p = ${a.f_p_value?.toFixed(3)}`,
    },
    {
      name: 'ARCH heteroscedasticity present',
      pass: v.arch_stat !== null && v.arch_stat > 3.84,
      value: v.arch_stat !== null ? `ARCH stat = ${v.arch_stat.toFixed(3)}` : 'N/A',
    },
  ]

  return (
    <div className="criteria-grid">
      {crit.map((c, i) => (
        <div key={i} className={`criterion ${c.pass ? 'pass' : 'fail'}`}>
          <span className="icon">{c.pass ? '✓' : '✗'}</span>
          <span className="cname">{c.name}</span>
          <span className="cval">{c.value}</span>
        </div>
      ))}
    </div>
  )
}
