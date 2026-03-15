import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { db } from '../api/supabase'
import type { VectorWithAnalysis, AnalysisResult } from '../types'

interface VectorsState {
  all: VectorWithAnalysis[]
  status: 'idle' | 'loading' | 'success' | 'error'
  error: string | null
}

const initialState: VectorsState = {
  all: [],
  status: 'idle',
  error: null,
}

export const fetchVectors = createAsyncThunk<VectorWithAnalysis[], void, { rejectValue: string }>(
  'vectors/fetchAll',
  async (_, { rejectWithValue }) => {
    // 1. Fetch all vectors
    const { data: vecs, error: vErr } = await db
      .from('vectors')
      .select('*')
      .order('acf_score', { ascending: false, nullsFirst: false })

    if (vErr) return rejectWithValue(vErr.message)

    // 2. Fetch all analysis results ordered by analysed_at desc
    const { data: analyses, error: aErr } = await db
      .from('analysis_results')
      .select(
        'vector_id, analysed_at, frequency, acf_at_seasonal_lag, acf_bound_95, acf_significant, f_stat, f_df_between, f_df_within, f_p_value, f_significant, verdict, complexity_score, complexity_grade, model_hint, training_data, validation_data'
      )
      .order('analysed_at', { ascending: false })

    if (aErr) return rejectWithValue(aErr.message)

    // De-duplicate: keep first (most recent) per vector_id
    const analysisMap: Record<number, AnalysisResult> = {}
    for (const a of (analyses ?? []) as AnalysisResult[]) {
      if (a.vector_id !== undefined && !analysisMap[a.vector_id]) {
        analysisMap[a.vector_id] = a
      }
    }

    // Merge
    return ((vecs ?? []) as VectorWithAnalysis[]).map(v => ({
      ...v,
      _analysis: analysisMap[v.vector_id] ?? null,
    }))
  }
)

const vectorsSlice = createSlice({
  name: 'vectors',
  initialState,
  reducers: {
    updateVectorAnalysis(
      state,
      action: PayloadAction<{ vectorId: number; analysis: AnalysisResult }>
    ) {
      const { vectorId, analysis } = action.payload
      const idx = state.all.findIndex(v => v.vector_id === vectorId)
      if (idx !== -1) {
        state.all[idx]._analysis = analysis
      }
    },
  },
  extraReducers: builder => {
    builder
      .addCase(fetchVectors.pending, state => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchVectors.fulfilled, (state, action) => {
        state.status = 'success'
        state.all = action.payload
      })
      .addCase(fetchVectors.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload ?? 'Unknown error'
      })
  },
})

export const { updateVectorAnalysis } = vectorsSlice.actions
export default vectorsSlice.reducer
