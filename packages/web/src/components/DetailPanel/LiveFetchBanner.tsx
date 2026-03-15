import React, { useState } from 'react'
import { useAppDispatch } from '../../store'
import { updateVectorAnalysis } from '../../store/vectorsSlice'
import { fetchVectorData, processPoints } from '../../api/statcan'
import { fullAnalyze } from '../../lib/analysis'
import { db } from '../../api/supabase'
import type { VectorWithAnalysis, AnalysisResult } from '../../types'

interface Props {
  v: VectorWithAnalysis
}

type StatusType = 'info' | 'error' | 'ok' | ''

export default function LiveFetchBanner({ v }: Props) {
  const dispatch = useAppDispatch()
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusType, setStatusType] = useState<StatusType>('')

  const setLive = (msg: string, cls: StatusType) => {
    setStatusMsg(msg)
    setStatusType(cls)
  }

  const handleFetch = async () => {
    setLoading(true)
    setLive('Fetching from Statistics Canada…', 'info')

    try {
      const dataArr = await fetchVectorData(v.vector_id, 112) as Array<{
        status: string
        object: { vectorDataPoint: Array<{ refPer: string; value: number | null }> }
      }>
      const dataItem = dataArr[0]
      if (dataItem?.status !== 'SUCCESS') {
        throw new Error(`Vector ${v.vector_id} not found on StatCan`)
      }

      setLive('Running analysis…', 'info')
      const { trainingData, validationData } = processPoints(dataItem.object.vectorDataPoint)
      if (trainingData.length < 24) {
        throw new Error(`Only ${trainingData.length} obs — need ≥ 24`)
      }

      const ana = fullAnalyze(trainingData)

      const liveA: AnalysisResult = {
        frequency: ana.s,
        acf_at_seasonal_lag: ana.acfAtS,
        acf_bound_95: ana.bound,
        acf_significant: ana.acfSig,
        f_stat: ana.fStat,
        f_df_between: ana.s - 1,
        f_df_within: trainingData.length - ana.s,
        f_p_value: ana.pValue,
        f_significant: ana.fSig,
        verdict: ana.verdict,
        complexity_score: ana.score,
        complexity_grade: ana.grade,
        model_hint: ana.modelHint,
        training_data: trainingData,
        validation_data: validationData,
      }

      // Sanitize: NaN/Infinity → fallback, float4 underflow → 0
      // PostgreSQL real (float4) min positive ≈ 1.175e-38; smaller values cause "out of range"
      const FLOAT4_MIN = 1.175494e-38
      const num = (x: number | null | undefined, fallback = 0) => {
        if (x == null || !isFinite(x)) return fallback
        if (x !== 0 && Math.abs(x) < FLOAT4_MIN) return 0
        return x
      }

      setLive('Saving to database…', 'info')
      const { error: saveErr } = await db.from('analysis_results').insert({
        vector_id:           v.vector_id,
        frequency:           num(liveA.frequency, 12),
        acf_at_seasonal_lag: num(liveA.acf_at_seasonal_lag),
        acf_bound_95:        num(liveA.acf_bound_95),
        acf_significant:     liveA.acf_significant ?? false,
        f_stat:              num(liveA.f_stat),
        f_df_between:        num(liveA.f_df_between),
        f_df_within:         num(liveA.f_df_within),
        f_p_value:           num(liveA.f_p_value, 1),
        f_significant:       liveA.f_significant ?? false,
        verdict:             liveA.verdict ?? 'inconclusive',
        complexity_score:    num(liveA.complexity_score),
        complexity_grade:    liveA.complexity_grade ?? 'AVOID (0/6)',
        model_hint:          liveA.model_hint,
        training_data:       liveA.training_data,
        validation_data:     liveA.validation_data,
      })

      if (saveErr) console.error('[LiveFetch] DB insert error:', saveErr)

      dispatch(updateVectorAnalysis({ vectorId: v.vector_id, analysis: liveA }))

      const savedNote = saveErr
        ? ` (DB save failed: ${saveErr.message})`
        : ' · Saved to DB'
      setLive(
        `Done — ${trainingData.length} training + ${validationData.length} validation obs${savedNote}.`,
        'ok'
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLive('Error: ' + msg, 'error')
      setLoading(false)
    }
  }

  return (
    <div id="liveAnalysisRow">
      <div className="live-banner">
        <span>No analysis stored in DB for this vector.</span>
        <button
          className="btn btn-sky"
          disabled={loading}
          onClick={handleFetch}
        >
          Fetch from StatCan &amp; Analyze
        </button>
        {statusMsg && (
          <span className={`live-status ${statusType}`}>{statusMsg}</span>
        )}
      </div>
    </div>
  )
}
