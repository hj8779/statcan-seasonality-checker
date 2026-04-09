import React, { useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Bar, Chart } from 'react-chartjs-2'
import type { VectorWithAnalysis, AnalysisResult, DataPoint } from '../../types'
import { mean, computeAcf } from '../../lib/analysis'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  Title,
  Tooltip,
  Legend,
  Filler
)

interface Props {
  v: VectorWithAnalysis
  a: AnalysisResult | null
}

const BLUE = 'rgba(59,130,246,0.9)'
const BLUE_F = 'rgba(59,130,246,0.12)'
const ORANGE = 'rgba(249,115,22,0.9)'
const RED = 'rgba(239,68,68,0.85)'
const GREY = 'rgba(100,116,139,0.55)'

export default function Charts({ v, a }: Props) {
  const td: DataPoint[] = useMemo(
    () => (a?.training_data ?? v.latest_pts ?? []).slice().sort((x, y) => x.date.localeCompare(y.date)),
    [a, v.latest_pts]
  )
  const vd: DataPoint[] = useMemo(
    () => (a?.validation_data ?? []).slice().sort((x, y) => x.date.localeCompare(y.date)),
    [a]
  )
  const s = a?.frequency ?? (v.frequency_code === 6 ? 12 : v.frequency_code === 9 ? 4 : 12)

  // Time series chart
  const tsData = useMemo(() => {
    if (td.length === 0) return null
    const all = [...td, ...vd]
    return {
      labels: all.map(d => d.date),
      datasets: [
        {
          label: `Training (${td.length})`,
          data: [...td.map(d => d.value), ...Array(vd.length).fill(null)],
          borderColor: BLUE,
          backgroundColor: BLUE_F,
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
        },
        {
          label: `Validation (${vd.length})`,
          data: [...Array(td.length).fill(null), ...vd.map(d => d.value)],
          borderColor: ORANGE,
          borderWidth: 2,
          borderDash: [6, 3],
          pointRadius: 3,
          fill: false,
        },
      ],
    }
  }, [td, vd])

  // ACF chart
  const acfData = useMemo(() => {
    if (td.length < s * 2) return null
    const values = td.map(d => d.value)
    const acf = computeAcf(values, 2 * s)
    const bound = a?.acf_bound_95 ?? 1.96 / Math.sqrt(values.length)
    const acfCol = acf.map((_, i) =>
      i === s - 1 || i === 2 * s - 1
        ? RED
        : Math.abs(acf[i]) > bound
        ? 'rgba(239,68,68,0.55)'
        : GREY
    )
    return {
      acf,
      bound,
      chartData: {
        labels: acf.map((_, i) => i + 1),
        datasets: [
          { label: 'ACF', data: acf, backgroundColor: acfCol, borderWidth: 0, type: 'bar' as const },
          {
            data: Array(acf.length).fill(bound),
            type: 'line' as const,
            borderColor: RED,
            borderWidth: 1.2,
            borderDash: [4, 3],
            pointRadius: 0,
            fill: false,
            label: '+95%',
          },
          {
            data: Array(acf.length).fill(-bound),
            type: 'line' as const,
            borderColor: RED,
            borderWidth: 1.2,
            borderDash: [4, 3],
            pointRadius: 0,
            fill: false,
            label: '-95%',
          },
        ],
      },
    }
  }, [td, s, a])

  // Seasonal means chart
  const smData = useMemo(() => {
    if (!a?.training_data || td.length < s) return null
    const values = td.map(d => d.value)
    const groups: number[][] = Array.from({ length: s }, () => [])
    for (const { date, value } of td) {
      const m = parseInt((date.split('-')[1] ?? '1'), 10)
      groups[(m - 1) % s].push(value)
    }
    const smeans = groups.map(g => (g.length ? mean(g) : 0))
    const gm = mean(smeans)
    const sLabels =
      s === 12
        ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        : ['Q1', 'Q2', 'Q3', 'Q4']

    return {
      labels: sLabels,
      datasets: [
        {
          label: 'Seasonal mean',
          data: smeans,
          backgroundColor: smeans.map(v => (v > gm ? BLUE : ORANGE)),
          borderWidth: 0,
          type: 'bar' as const,
        },
        {
          data: Array(s).fill(gm),
          type: 'line' as const,
          borderColor: '#64748b',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          fill: false,
          label: 'Grand mean',
        },
      ],
    }
  }, [td, a, s])

  const commonOptions = {
    animation: false as const,
    responsive: true,
    maintainAspectRatio: true,
  }

  return (
    <>
      {tsData && (
        <div className="card">
          <h3 className="chart-title">
            Time Series (blue = training · orange = validation)
          </h3>
          <Line
            data={tsData}
            options={{
              ...commonOptions,
              plugins: { legend: { position: 'top' as const } },
              scales: { x: { ticks: { maxTicksLimit: 20 } } },
            }}
          />
        </div>
      )}

      <div className="chart-row">
        {acfData && (
          <div className="card">
            <h3 className="chart-title">ACF (red bars = seasonal lags)</h3>
            <Chart
              type="bar"
              data={acfData.chartData}
              options={{
                ...commonOptions,
                plugins: { legend: { display: false } },
                scales: {
                  y: { min: -1, max: 1, title: { display: true, text: 'r_k' } },
                },
              }}
            />
          </div>
        )}
        {smData && (
          <div className="card">
            <h3 className="chart-title">Seasonal Means</h3>
            <Chart
              type="bar"
              data={smData}
              options={{
                ...commonOptions,
                plugins: { legend: { display: false } },
              }}
            />
          </div>
        )}
      </div>
    </>
  )
}
