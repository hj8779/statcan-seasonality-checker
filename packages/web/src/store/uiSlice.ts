import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { COLUMNS } from '../types'

interface UiState {
  query: string
  filterVerdict: string
  filterFreq: string
  filterGrade: string
  sortCol: string
  sortDir: number
  page: number
  colOrder: string[]
  selectedId: number | null
}

const initialState: UiState = {
  query: '',
  filterVerdict: '',
  filterFreq: '',
  filterGrade: '',
  sortCol: 'acfScore',
  sortDir: -1,
  page: 0,
  colOrder: COLUMNS.map(c => c.key),
  selectedId: null,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setQuery(state, action: PayloadAction<string>) {
      state.query = action.payload
      state.page = 0
    },
    setFilterVerdict(state, action: PayloadAction<string>) {
      state.filterVerdict = action.payload
      state.page = 0
    },
    setFilterFreq(state, action: PayloadAction<string>) {
      state.filterFreq = action.payload
      state.page = 0
    },
    setFilterGrade(state, action: PayloadAction<string>) {
      state.filterGrade = action.payload
      state.page = 0
    },
    setSortCol(state, action: PayloadAction<string>) {
      const col = action.payload
      if (state.sortCol === col) {
        state.sortDir = -state.sortDir
      } else {
        state.sortCol = col
        state.sortDir = col === 'seriesTitle' || col === 'tableId' ? 1 : -1
      }
      state.page = 0
    },
    toggleSortDir(state) {
      state.sortDir = -state.sortDir
      state.page = 0
    },
    setPage(state, action: PayloadAction<number>) {
      state.page = action.payload
    },
    resetFilters(state) {
      state.query = ''
      state.filterVerdict = ''
      state.filterFreq = ''
      state.filterGrade = ''
      state.page = 0
    },
    setColOrder(state, action: PayloadAction<string[]>) {
      state.colOrder = action.payload
    },
    setSelectedId(state, action: PayloadAction<number | null>) {
      state.selectedId = action.payload
    },
  },
})

export const {
  setQuery,
  setFilterVerdict,
  setFilterFreq,
  setFilterGrade,
  setSortCol,
  toggleSortDir,
  setPage,
  resetFilters,
  setColOrder,
  setSelectedId,
} = uiSlice.actions

export default uiSlice.reducer
