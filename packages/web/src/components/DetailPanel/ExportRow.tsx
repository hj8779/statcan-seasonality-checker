import React, { useState } from 'react'
import type { VectorWithAnalysis, AnalysisResult } from '../../types'
import { exportCsv, exportJson } from '../../lib/export'

interface Props {
  v: VectorWithAnalysis
  a: AnalysisResult | null
}

export default function ExportRow({ v, a }: Props) {
  const [statusMsg, setStatusMsg] = useState('')
  const [statusType, setStatusType] = useState<'info' | 'error'>('info')

  const showStatus = (msg: string, type: 'info' | 'error') => {
    setStatusMsg(msg)
    setStatusType(type)
    setTimeout(() => setStatusMsg(''), 4000)
  }

  const handleCsv = () => {
    const msg = exportCsv(v, a)
    if (msg === null) {
      showStatus('No data available to export.', 'error')
    } else {
      showStatus(msg, 'info')
    }
  }

  const handleJson = () => {
    const msg = exportJson(v, a)
    showStatus(msg, 'info')
  }

  const handleStatcan = () => {
    if (!v.table_id) return
    const pid = v.table_id.replace(/-/g, '')
    window.open(`https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=${pid}`, '_blank')
  }

  return (
    <>
      <div className="export-row">
        <label>Export CANSIM data:</label>
        <button className="btn btn-green" onClick={handleCsv}>
          Download CSV
        </button>
        <button className="btn btn-secondary" onClick={handleJson}>
          Download JSON
        </button>
        <button
          className="btn btn-secondary"
          disabled={!v.table_id}
          onClick={handleStatcan}
        >
          Open on StatCan
        </button>
      </div>
      {statusMsg && (
        <div className={`status-msg ${statusType}`}>{statusMsg}</div>
      )}
    </>
  )
}
