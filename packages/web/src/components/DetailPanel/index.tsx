import React, { useEffect, useRef } from 'react'
import { useAppSelector } from '../../store'
import { FREQ_LABEL } from '../../types'
import CriteriaGrid from './CriteriaGrid'
import VerdictBox from './VerdictBox'
import Charts from './Charts'
import LiveFetchBanner from './LiveFetchBanner'
import ExportRow from './ExportRow'

export default function DetailPanel() {
  const selectedId = useAppSelector(s => s.ui.selectedId)
  const allVectors = useAppSelector(s => s.vectors.all)
  const panelRef = useRef<HTMLDivElement>(null)

  const v = selectedId !== null ? allVectors.find(x => x.vector_id === selectedId) : undefined

  useEffect(() => {
    if (v && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedId])

  if (!v) return null

  const a = v._analysis

  const dateFrom =
    v.start_date ??
    a?.training_data?.[0]?.date ??
    (v.latest_pts ? v.latest_pts[v.latest_pts.length - 1]?.date : undefined) ??
    '?'
  const dateTo =
    v.end_date ??
    (a?.validation_data ? a.validation_data[a.validation_data.length - 1]?.date : undefined) ??
    (a?.training_data ? a.training_data[a.training_data.length - 1]?.date : undefined) ??
    '?'

  const gradeShort = a ? (a.complexity_grade ?? '').replace(/\s*\(\d\/6\)/, '').trim() : null
  const gradeColor = a
    ? a.complexity_grade?.startsWith('EXCELLENT')
      ? '#14532d'
      : a.complexity_grade?.startsWith('GOOD')
      ? '#1e3a8a'
      : a.complexity_grade?.startsWith('MARGINAL')
      ? '#78350f'
      : '#7f1d1d'
    : undefined

  return (
    <div ref={panelRef} id="detailPanel">
      {/* Series info + grade */}
      <div className="card">
        <div className="info-header">
          <div>
            <div className="series-title">{v.series_title ?? `Vector ${v.vector_id}`}</div>
            <div className="series-meta">
              Vector {v.vector_id} &nbsp;·&nbsp; Table {v.table_id ?? '?'} &nbsp;·&nbsp;
              {FREQ_LABEL[v.frequency_code ?? 0] ?? v.frequency_code} &nbsp;·&nbsp;
              {dateFrom} → {dateTo}
            </div>
          </div>
          <div className="grade-box">
            <div className="grade-label">Assignment suitability</div>
            <div className="grade-value" style={gradeColor ? { color: gradeColor } : {}}>
              {gradeShort ?? '—'}
            </div>
            <div className="grade-sub">
              {a ? `${a.complexity_score ?? '?'} / 6 criteria met` : 'Not analysed yet'}
            </div>
          </div>
        </div>

        {a?.model_hint && (
          <div className="model-hint">{a.model_hint}</div>
        )}

        <CriteriaGrid v={v} a={a} />

        {!a && <LiveFetchBanner v={v} />}

        <ExportRow v={v} a={a} />
      </div>

      {/* Charts */}
      <Charts v={v} a={a} />

      {/* Verdict box */}
      <div className="card">
        <h3 className="chart-title">Seasonality Tests</h3>
        <VerdictBox a={a} />
      </div>
    </div>
  )
}
