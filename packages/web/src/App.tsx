import React, { useEffect } from 'react'
import { useAppDispatch } from './store'
import { fetchVectors } from './store/vectorsSlice'
import DbPill from './components/DbPill'
import Toolbar from './components/Toolbar'
import VectorTable from './components/VectorTable'
import DetailPanel from './components/DetailPanel'
import CoverageMap from './components/CoverageMap'

export default function App() {
  const dispatch = useAppDispatch()

  useEffect(() => {
    dispatch(fetchVectors())
  }, [dispatch])

  return (
    <>
      <header>
        <h1>CANSIM Vector Explorer</h1>
        <p>Browse scanned Statistics Canada vectors, view seasonality reports, and export data.</p>
      </header>

      <CoverageMap />

      <div className="card">
        <DbPill />
        <Toolbar />
        <div className="tbl-wrap">
          <VectorTable />
        </div>
      </div>

      <DetailPanel />
    </>
  )
}
