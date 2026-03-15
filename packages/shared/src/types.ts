export interface DataPoint { date: string; value: number }

export interface Vector {
  vector_id: number
  table_id: string | null
  series_title: string | null
  frequency_code: number | null
  acf_score: number | null
  acf_lag: number | null
  acf_n_obs: number | null
  mean_val: number | null
  variance: number | null
  arch_stat: number | null
  stationarity: number | null
  latest_pts: DataPoint[] | null
  scanned_at: string | null
  start_date: string | null
  end_date: string | null
}

export interface AnalysisResult {
  vector_id?: number
  frequency: number | null
  acf_at_seasonal_lag: number | null
  acf_bound_95: number | null
  acf_significant: boolean | null
  f_stat: number | null
  f_df_between: number | null
  f_df_within: number | null
  f_p_value: number | null
  f_significant: boolean | null
  verdict: 'seasonal' | 'not_seasonal' | 'inconclusive' | null
  complexity_score: number | null
  complexity_grade: string | null
  model_hint: string | null
  training_data: DataPoint[] | null
  validation_data: DataPoint[] | null
  analysed_at?: string | null
}

export interface VectorWithAnalysis extends Vector {
  _analysis: AnalysisResult | null
}

export interface RawPoint {
  refPer: string
  value: number | null
}

export interface FullAnalysis {
  s: number
  acf: number[]
  pacf: number[]
  bound: number
  acfAtS: number
  acfSig: boolean
  fStat: number
  pValue: number
  fSig: boolean
  verdict: 'seasonal' | 'not_seasonal' | 'inconclusive'
  seasonalMeans: number[]
  score: number
  grade: string
  gradeColor: string
  crit: Array<{ name: string; pass: boolean; value: string }>
  modelHint: string
}

export const COLUMNS = [
  { key: 'vectorId',        label: 'Vector ID' },
  { key: 'tableId',         label: 'Table ID' },
  { key: 'seriesTitle',     label: 'Series Title' },
  { key: 'frequencyCode',   label: 'Freq' },
  { key: 'acfScore',        label: 'ACF(s)' },
  { key: 'complexityScore', label: 'Grade' },
  { key: 'verdict',         label: 'Verdict' },
  { key: 'stationarity',    label: 'Stationarity' },
  { key: 'scannedAt',       label: 'Scanned' },
] as const

export type ColumnKey = typeof COLUMNS[number]['key']

export const FREQ_LABEL: Record<number, string> = {
  1: 'Daily',
  6: 'Monthly',
  9: 'Quarterly',
  12: 'Annual',
}
