import type { VectorWithAnalysis, AnalysisResult } from '../types'

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportCsv(v: VectorWithAnalysis, a: AnalysisResult | null): string | null {
  const td = a?.training_data ?? v.latest_pts ?? []
  const vd = a?.validation_data ?? []
  if (td.length === 0 && vd.length === 0) return null

  const header = 'date,value,split'
  const rows = [
    ...td.map(d => `${d.date},${d.value},training`),
    ...vd.map(d => `${d.date},${d.value},validation`),
  ]
  const csv = [header, ...rows].join('\n')
  download(`cansim_v${v.vector_id}_${v.table_id ?? 'data'}.csv`, csv, 'text/csv')
  return `Exported ${td.length + vd.length} observations as CSV.`
}

export function exportJson(v: VectorWithAnalysis, a: AnalysisResult | null): string {
  const payload = {
    vectorId: v.vector_id,
    tableId: v.table_id,
    seriesTitle: v.series_title,
    frequencyCode: v.frequency_code,
    startDate: v.start_date,
    endDate: v.end_date,
    analysis: a
      ? {
          verdict: a.verdict,
          complexityGrade: a.complexity_grade,
          complexityScore: a.complexity_score,
          modelHint: a.model_hint,
          acfAtSeasonalLag: a.acf_at_seasonal_lag,
          acfBound95: a.acf_bound_95,
          fStat: a.f_stat,
          fPValue: a.f_p_value,
          analysedAt: a.analysed_at,
        }
      : null,
    trainingData: a?.training_data ?? v.latest_pts ?? [],
    validationData: a?.validation_data ?? [],
  }
  download(
    `cansim_v${v.vector_id}_${v.table_id ?? 'data'}.json`,
    JSON.stringify(payload, null, 2),
    'application/json'
  )
  return 'Exported full analysis as JSON.'
}
