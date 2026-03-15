import React from 'react'
import { useAppDispatch, useAppSelector, selectFiltered } from '../../store'
import { setSortCol, setSelectedId } from '../../store/uiSlice'
import { COLUMNS, FREQ_LABEL } from '../../types'
import type { VectorWithAnalysis } from '../../types'
import { PAGE_SIZE } from '../../config'
import Pagination from './Pagination'
import { useColumnDrag } from './useColumnDrag'

function verdictChip(v: string | null | undefined) {
  if (!v) return <span className="verdict-chip v-none">—</span>
  const labels: Record<string, string> = {
    seasonal: 'Seasonal',
    not_seasonal: 'Not seasonal',
    inconclusive: 'Inconclusive',
  }
  return <span className={`verdict-chip v-${v}`}>{labels[v] ?? v}</span>
}

function gradeChip(g: string | null | undefined) {
  if (!g) return <span className="grade-chip g-none">—</span>
  const cls = g.startsWith('EXCELLENT')
    ? 'g-excellent'
    : g.startsWith('GOOD')
    ? 'g-good'
    : g.startsWith('MARGINAL')
    ? 'g-marginal'
    : g.startsWith('AVOID')
    ? 'g-avoid'
    : 'g-none'
  const short = g.replace(/\s*\(\d\/6\)/, '').trim()
  return <span className={`grade-chip ${cls}`}>{short}</span>
}

function acfBar(score: number | null | undefined) {
  if (score === null || score === undefined) return <span>—</span>
  const pct = Math.min(Math.abs(score) * 100, 100).toFixed(0)
  const color =
    Math.abs(score) > 0.5 ? '#3b82f6' : Math.abs(score) > 0.2 ? '#f59e0b' : '#94a3b8'
  return (
    <div className="acf-bar">
      <div className="acf-bar-fill" style={{ width: `${pct}px`, background: color }} />
      <span className="acf-val">{score.toFixed(3)}</span>
    </div>
  )
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function renderCell(v: VectorWithAnalysis, key: string) {
  const a = v._analysis
  switch (key) {
    case 'vectorId':
      return <td key={key}>{v.vector_id}</td>
    case 'tableId':
      return (
        <td key={key}>
          <code style={{ fontSize: '.78rem' }}>{v.table_id ?? '—'}</code>
        </td>
      )
    case 'seriesTitle':
      return (
        <td key={key} className="td-title" title={v.series_title ?? ''}>
          {v.series_title ?? '—'}
        </td>
      )
    case 'frequencyCode':
      return (
        <td key={key}>
          {FREQ_LABEL[v.frequency_code ?? 0] ?? v.frequency_code ?? '—'}
        </td>
      )
    case 'acfScore':
      return <td key={key}>{acfBar(v.acf_score)}</td>
    case 'complexityScore':
      return <td key={key}>{gradeChip(a?.complexity_grade)}</td>
    case 'verdict':
      return <td key={key}>{verdictChip(a?.verdict)}</td>
    case 'stationarity':
      return (
        <td key={key}>
          {v.stationarity != null ? v.stationarity.toFixed(3) : '—'}
        </td>
      )
    case 'scannedAt':
      return (
        <td key={key} style={{ whiteSpace: 'nowrap' }}>
          {fmtDate(v.scanned_at)}
        </td>
      )
    default:
      return <td key={key}>—</td>
  }
}

export default function VectorTable() {
  const dispatch = useAppDispatch()
  const sortCol = useAppSelector(s => s.ui.sortCol)
  const sortDir = useAppSelector(s => s.ui.sortDir)
  const page = useAppSelector(s => s.ui.page)
  const colOrder = useAppSelector(s => s.ui.colOrder)
  const selectedId = useAppSelector(s => s.ui.selectedId)
  const status = useAppSelector(s => s.vectors.status)
  const error = useAppSelector(s => s.vectors.error)
  const filtered = useAppSelector(selectFiltered)

  const { dragProps } = useColumnDrag(colOrder)

  const start = page * PAGE_SIZE
  const pageRows = filtered.slice(start, start + PAGE_SIZE)

  const handleSort = (key: string) => {
    dispatch(setSortCol(key))
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="tbl-wrap">
        <table className="vtbl">
          <tbody>
            <tr>
              <td colSpan={colOrder.length} className="tbl-placeholder">
                Loading vectors from database…
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="tbl-wrap">
        <table className="vtbl">
          <tbody>
            <tr>
              <td
                colSpan={colOrder.length}
                className="tbl-placeholder"
                style={{ color: '#dc2626' }}
              >
                Error: {error}
                <br />
                <small>Check your SUPABASE_ANON_KEY in the page source.</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <div className="tbl-wrap">
        <table className="vtbl">
          <thead>
            <tr>
              {colOrder.map((key, idx) => {
                const col = COLUMNS.find(c => c.key === key)
                const active = sortCol === key
                const icon = active ? (sortDir === -1 ? ' ↓' : ' ↑') : ' ↕'
                return (
                  <th
                    key={key}
                    className={active ? 'active' : ''}
                    onClick={() => handleSort(key)}
                    {...dragProps(idx)}
                  >
                    {col?.label ?? key}
                    <span className="sort-icon">{icon}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={colOrder.length} className="tbl-placeholder">
                  No vectors match the current filters.
                </td>
              </tr>
            ) : (
              pageRows.map(v => (
                <tr
                  key={v.vector_id}
                  className={v.vector_id === selectedId ? 'selected' : ''}
                  onClick={() => dispatch(setSelectedId(v.vector_id))}
                >
                  {colOrder.map(k => renderCell(v, k))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination />
    </>
  )
}
