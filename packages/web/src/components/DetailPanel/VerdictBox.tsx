import React from 'react'
import type { AnalysisResult } from '../../types'

interface Props {
  a: AnalysisResult | null
}

const VCOLOR: Record<string, string> = {
  seasonal: '#166534',
  not_seasonal: '#1e3a8a',
  inconclusive: '#92400e',
}
const VBGC: Record<string, string> = {
  seasonal: '#dcfce7',
  not_seasonal: '#dbeafe',
  inconclusive: '#fef3c7',
}
const VLBL: Record<string, string> = {
  seasonal: 'SEASONAL',
  not_seasonal: 'NOT SEASONAL',
  inconclusive: 'INCONCLUSIVE',
}

export default function VerdictBox({ a }: Props) {
  const verdict = a?.verdict ?? null
  const bgColor = verdict ? (VBGC[verdict] ?? '#f1f5f9') : '#f1f5f9'
  const borderColor = verdict ? (VCOLOR[verdict] ?? '#e2e8f0') : '#e2e8f0'
  const color = verdict ? (VCOLOR[verdict] ?? '#475569') : '#94a3b8'
  const label = verdict ? (VLBL[verdict] ?? verdict) : 'No analysis in database'

  const fmtPval = (p: number | null | undefined) => {
    if (p === null || p === undefined) return '—'
    return p < 0.0001 ? '< 0.0001' : p.toFixed(4)
  }

  return (
    <div
      className="verdict-box"
      style={{ background: bgColor, borderColor, color }}
    >
      <div className="verdict-tag">{label}</div>
      <table className="stat-table">
        <tbody>
          <tr>
            <th>
              ACF r<sub>{a?.frequency ?? 's'}</sub>
            </th>
            <td>{a?.acf_at_seasonal_lag?.toFixed(4) ?? '—'}</td>
            <th>95% bound</th>
            <td>
              {a?.acf_bound_95 !== null && a?.acf_bound_95 !== undefined
                ? `±${a.acf_bound_95.toFixed(4)}`
                : '—'}
            </td>
          </tr>
          <tr>
            <th>F statistic</th>
            <td>{a?.f_stat?.toFixed(3) ?? '—'}</td>
            <th>p-value</th>
            <td>{fmtPval(a?.f_p_value)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
