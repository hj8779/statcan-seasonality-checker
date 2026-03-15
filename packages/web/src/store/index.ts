import { configureStore } from '@reduxjs/toolkit'
import { createSelector } from '@reduxjs/toolkit'
import vectorsReducer from './vectorsSlice'
import uiReducer from './uiSlice'
import type { VectorWithAnalysis } from '../types'

export const store = configureStore({
  reducer: {
    vectors: vectorsReducer,
    ui: uiReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

// ── Typed hooks ─────────────────────────────────────────────────────────────
import { useDispatch, useSelector } from 'react-redux'
export const useAppDispatch = () => useDispatch<AppDispatch>()
export const useAppSelector = <T>(selector: (state: RootState) => T) =>
  useSelector<RootState, T>(selector)

// ── Selectors ────────────────────────────────────────────────────────────────

function getColVal(v: VectorWithAnalysis, col: string): string | number | null | undefined {
  const a = v._analysis
  switch (col) {
    case 'vectorId':        return v.vector_id
    case 'tableId':         return v.table_id
    case 'seriesTitle':     return v.series_title
    case 'frequencyCode':   return v.frequency_code
    case 'acfScore':        return v.acf_score
    case 'stationarity':    return v.stationarity
    case 'scannedAt':       return v.scanned_at
    case 'complexityScore': return a?.complexity_score ?? -1
    case 'verdict':         return a?.verdict ?? ''
    default:                return null
  }
}

export const selectFiltered = createSelector(
  (state: RootState) => state.vectors.all,
  (state: RootState) => state.ui.query,
  (state: RootState) => state.ui.filterVerdict,
  (state: RootState) => state.ui.filterFreq,
  (state: RootState) => state.ui.filterGrade,
  (state: RootState) => state.ui.sortCol,
  (state: RootState) => state.ui.sortDir,
  (all, query, filterVerdict, filterFreq, filterGrade, sortCol, sortDir) => {
    const q = query.trim().toLowerCase()
    let result = all.filter(v => {
      const a = v._analysis
      if (q) {
        const hay = `${v.vector_id} ${v.table_id ?? ''} ${v.series_title ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filterVerdict === 'none') {
        if (a?.verdict) return false
      } else if (filterVerdict) {
        if ((a?.verdict ?? '') !== filterVerdict) return false
      }
      if (filterFreq && String(v.frequency_code) !== filterFreq) return false
      if (filterGrade && !((a?.complexity_grade ?? '').startsWith(filterGrade))) return false
      return true
    })

    result = [...result].sort((a, b) => {
      const av = getColVal(a, sortCol)
      const bv = getColVal(b, sortCol)
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      if (typeof av === 'string' && typeof bv === 'string') return sortDir * av.localeCompare(bv)
      return sortDir * ((av as number) - (bv as number))
    })

    return result
  }
)
