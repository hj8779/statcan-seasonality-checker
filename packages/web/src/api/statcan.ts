import { SUPABASE_URL, SUPABASE_ANON_KEY, N_TOTAL, N_TRAIN } from '../config'
import type { DataPoint, RawPoint } from '../types'

const PROXY_URL = `${SUPABASE_URL}/functions/v1/statcan-proxy`

export const fetchVectorData = async (vectorId: number, latestN: number): Promise<unknown[]> => {
  const r = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ vectorId, latestN }),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`Proxy error HTTP ${r.status}: ${txt}`)
  }
  return r.json()
}

export const processPoints = (pts: RawPoint[]): { trainingData: DataPoint[]; validationData: DataPoint[] } => {
  const all = pts
    .filter(p => p.value !== null)
    .map(p => ({ date: p.refPer, value: p.value as number }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const win = all.slice(-N_TOTAL)
  return { trainingData: win.slice(0, N_TRAIN), validationData: win.slice(N_TRAIN) }
}
