import React, { useCallback, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import {
  setQuery,
  setFilterVerdict,
  setFilterFreq,
  setFilterGrade,
  resetFilters,
} from '../store/uiSlice'
import { selectFiltered } from '../store'

export default function Toolbar() {
  const dispatch = useAppDispatch()
  const query = useAppSelector(s => s.ui.query)
  const filterVerdict = useAppSelector(s => s.ui.filterVerdict)
  const filterFreq = useAppSelector(s => s.ui.filterFreq)
  const filterGrade = useAppSelector(s => s.ui.filterGrade)
  const filtered = useAppSelector(selectFiltered)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => dispatch(setQuery(val)), 250)
    },
    [dispatch]
  )

  return (
    <div className="toolbar">
      <input
        type="search"
        defaultValue={query}
        placeholder="Search title, vector ID, or table ID…"
        onChange={handleSearch}
      />
      <select
        value={filterVerdict}
        onChange={e => dispatch(setFilterVerdict(e.target.value))}
      >
        <option value="">All verdicts</option>
        <option value="seasonal">Seasonal</option>
        <option value="not_seasonal">Not seasonal</option>
        <option value="inconclusive">Inconclusive</option>
        <option value="none">Not analysed</option>
      </select>
      <select
        value={filterFreq}
        onChange={e => dispatch(setFilterFreq(e.target.value))}
      >
        <option value="">All frequencies</option>
        <option value="6">Monthly</option>
        <option value="9">Quarterly</option>
        <option value="12">Annual</option>
        <option value="1">Daily</option>
      </select>
      <select
        value={filterGrade}
        onChange={e => dispatch(setFilterGrade(e.target.value))}
      >
        <option value="">All grades</option>
        <option value="EXCELLENT">Excellent</option>
        <option value="GOOD">Good</option>
        <option value="MARGINAL">Marginal</option>
        <option value="AVOID">Avoid</option>
      </select>
      <button className="btn btn-secondary" onClick={() => dispatch(resetFilters())}>
        Reset
      </button>
      <span className="count-badge">
        {filtered.length} vector{filtered.length !== 1 ? 's' : ''} shown
      </span>
    </div>
  )
}
