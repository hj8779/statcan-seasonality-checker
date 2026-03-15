import React from 'react'
import type { VectorWithAnalysis, AnalysisResult } from '../../types'
import { fullAnalyze } from '../../lib/analysis'

interface Props {
  v: VectorWithAnalysis
  a: AnalysisResult | null
}

export default function CriteriaGrid({ v: _v, a }: Props) {
  if (!a) {
    return <p style={{ fontSize: '.82rem', color: '#94a3b8' }}>No analysis data available.</p>
  }

  if (!a.training_data || a.training_data.length === 0) {
    return <p style={{ fontSize: '.82rem', color: '#94a3b8' }}>No training data available.</p>
  }

  const { crit } = fullAnalyze(a.training_data)

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
