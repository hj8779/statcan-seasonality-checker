/**
 * CoverageMap — canvas-based Vector ID number line.
 *
 * Shows which regions of the StatCan vector ID space have been scanned,
 * where errors occurred, and which large gaps are candidates for probing.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  ████  ████████   ██  ██████  ██             ██████      │  ← blue = scanned
 *   │                               ██                         │  ← red  = error
 *   │─────────────────────────────────────────────────────────│
 *   │  0                       54,000,000          108,789,200 │
 *   └──────────────────────────────────────────────────────────┘
 *   Gaps between clusters = suggested probe ranges
 */

import { useEffect, useRef, useMemo, useState } from 'react'
import { useAppSelector } from '../../store'
import { db } from '../../api/supabase'

// ── Constants ────────────────────────────────────────────────────────────────

/** Logical pixel width of the canvas (CSS scales it to 100%) */
const CANVAS_W = 1400
const CANVAS_H = 60
const AXIS_H   = 14   // height reserved for tick labels at bottom

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskRow { vector_id: number; status: string }

interface Gap { from: number; to: number; size: number }

// ── Helpers ──────────────────────────────────────────────────────────────────

function toX(id: number, maxId: number, W: number) {
  return Math.min(W - 1, Math.round((id / maxId) * (W - 1)))
}

function fmtId(n: number) {
  return n.toLocaleString()
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CoverageMap() {
  const allVectors = useAppSelector(s => s.vectors.all)
  const status     = useAppSelector(s => s.vectors.status)

  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const [tasks, setTasks]     = useState<TaskRow[]>([])
  const [hoverId, setHoverId] = useState<number | null>(null)
  const [hoverX, setHoverX]   = useState(0)
  const [copied, setCopied]   = useState<number | null>(null)

  // Fetch scan_task statuses (errors / skipped) once
  useEffect(() => {
    if (status !== 'success') return
    db.from('scan_tasks')
      .select('vector_id, status')
      .in('status', ['error', 'skipped'])
      .limit(50_000)
      .then(({ data }) => { if (data) setTasks(data as TaskRow[]) })
  }, [status])

  // Build sorted ID sets
  const { scannedIds, errorIds, skippedIds, maxId } = useMemo(() => {
    const scannedIds = allVectors
      .map(v => v.vector_id)
      .filter((id): id is number => id != null)
      .sort((a, b) => a - b)

    const scannedSet = new Set(scannedIds)
    const errorIds: number[]   = []
    const skippedIds: number[] = []

    for (const t of tasks) {
      if (scannedSet.has(t.vector_id)) continue
      if (t.status === 'error')   errorIds.push(t.vector_id)
      else                        skippedIds.push(t.vector_id)
    }

    const allMax = Math.max(
      scannedIds.at(-1) ?? 0,
      ...errorIds,
      ...skippedIds,
    )

    return { scannedIds, errorIds, skippedIds, maxId: allMax }
  }, [allVectors, tasks])

  // Compute top-5 largest gaps in the combined sorted ID list
  const gaps = useMemo<Gap[]>(() => {
    const allIds = [
      ...scannedIds,
      ...errorIds,
      ...skippedIds,
    ].sort((a, b) => a - b)

    if (allIds.length < 2) return []

    const raw: Gap[] = []
    for (let i = 1; i < allIds.length; i++) {
      const size = allIds[i]! - allIds[i - 1]! - 1
      if (size > 0) raw.push({ from: allIds[i - 1]! + 1, to: allIds[i]! - 1, size })
    }
    // Also gap from 0 to first known ID
    if (allIds[0]! > 0) raw.push({ from: 0, to: allIds[0]! - 1, size: allIds[0]! })

    return raw.sort((a, b) => b.size - a.size).slice(0, 5)
  }, [scannedIds, errorIds, skippedIds])

  // Draw canvas whenever data changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || maxId === 0) return
    const ctx = canvas.getContext('2d')!
    const W = CANVAS_W
    const barH = CANVAS_H - AXIS_H

    ctx.clearRect(0, 0, W, CANVAS_H)

    // Background
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, 0, W, barH)

    // Bin scanned IDs (blue) and error IDs (red)
    const blueBins = new Int32Array(W)
    const redBins  = new Int32Array(W)

    for (const id of scannedIds) blueBins[toX(id, maxId, W)]++
    for (const id of errorIds)   redBins[toX(id, maxId, W)]++

    let maxBlue = 1
    for (const v of blueBins) if (v > maxBlue) maxBlue = v

    for (let x = 0; x < W; x++) {
      if (blueBins[x] > 0) {
        const alpha = 0.35 + (blueBins[x] / maxBlue) * 0.65
        ctx.fillStyle = `rgba(59,130,246,${alpha.toFixed(2)})`
        ctx.fillRect(x, 0, 1, barH)
      }
      if (redBins[x] > 0) {
        ctx.fillStyle = 'rgba(239,68,68,0.85)'
        ctx.fillRect(x, 0, 1, barH)
      }
    }

    // Axis line
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(0, barH, W, 1)

    // Tick marks + labels
    ctx.fillStyle = '#94a3b8'
    ctx.font = '10px monospace'

    for (let pct = 0; pct <= 100; pct += 10) {
      const x   = Math.round((pct / 100) * (W - 1))
      const id  = Math.round((pct / 100) * maxId)
      ctx.fillStyle = '#cbd5e1'
      ctx.fillRect(x, barH, 1, 4)
      ctx.fillStyle = '#94a3b8'
      ctx.textAlign = pct === 0 ? 'left' : pct === 100 ? 'right' : 'center'
      if (pct % 20 === 0 || pct === 100) {
        ctx.fillText(fmtId(id), x, CANVAS_H - 1)
      }
    }
  }, [scannedIds, errorIds, maxId])

  // Hover: map cursor x → vector ID
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    setHoverId(Math.round(ratio * maxId))
    setHoverX(e.clientX - rect.left)
  }

  const handleCopy = (gap: Gap, idx: number) => {
    const text = `--start=${gap.from} --end=${gap.to}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(idx)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  if (status !== 'success' || allVectors.length === 0) return null

  return (
    <div style={{
      background: 'white',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: '0.85rem 1rem 0.75rem',
      marginBottom: '1rem',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>
          Vector ID Coverage Map
        </span>
        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
          0 – {fmtId(maxId)} &nbsp;·&nbsp; {fmtId(scannedIds.length)} scanned
        </span>
      </div>

      {/* ── Canvas ─────────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ width: '100%', height: CANVAS_H, display: 'block', borderRadius: 4, cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverId(null)}
        />
        {hoverId !== null && (
          <div style={{
            position:      'absolute',
            top:           0,
            left:          `${(hoverId / maxId) * 100}%`,
            transform:     'translate(-50%, -110%)',
            background:    '#1e293b',
            color:         '#fff',
            padding:       '2px 8px',
            borderRadius:  4,
            fontSize:      '0.72rem',
            fontFamily:    'monospace',
            pointerEvents: 'none',
            whiteSpace:    'nowrap',
          }}>
            v{fmtId(hoverId)}
          </div>
        )}
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.35rem' }}>
        {([
          { color: '#3b82f6', label: `Scanned (${fmtId(scannedIds.length)})` },
          { color: '#ef4444', label: `Error (${fmtId(errorIds.length)})` },
          { color: '#94a3b8', label: `Skipped / few-obs (${fmtId(skippedIds.length)})` },
        ] as const).map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#64748b' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
            {label}
          </div>
        ))}
      </div>

      {/* ── Gap suggestions ─────────────────────────────────────────────────── */}
      {gaps.length > 0 && (
        <div style={{ marginTop: '0.65rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.6rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
            Largest unscanned gaps — click to copy
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {gaps.map((g, i) => (
              <button
                key={i}
                onClick={() => handleCopy(g, i)}
                style={{
                  background:   copied === i ? '#d1fae5' : '#eff6ff',
                  border:       `1px solid ${copied === i ? '#6ee7b7' : '#bfdbfe'}`,
                  color:        copied === i ? '#065f46' : '#1d4ed8',
                  borderRadius: 4,
                  padding:      '3px 10px',
                  fontSize:     '0.72rem',
                  fontFamily:   'monospace',
                  cursor:       'pointer',
                  transition:   'background 0.2s, border-color 0.2s',
                  display:      'flex',
                  alignItems:   'center',
                  gap:          6,
                }}
              >
                {copied === i ? '✓ copied' : `--start=${g.from} --end=${g.to}`}
                <span style={{ color: '#94a3b8', fontFamily: 'sans-serif', fontWeight: 400 }}>
                  {fmtId(g.size)} IDs
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
