import React from 'react'
import { useAppSelector } from '../store'

export default function DbPill() {
  const status = useAppSelector(s => s.vectors.status)
  const count = useAppSelector(s => s.vectors.all.length)
  const error = useAppSelector(s => s.vectors.error)

  let cls = 'connecting'
  let text = 'Connecting…'

  if (status === 'loading') {
    cls = 'connecting'
    text = 'Connecting…'
  } else if (status === 'success') {
    cls = 'connected'
    text = `Connected — ${count} vectors`
  } else if (status === 'error') {
    cls = 'error'
    text = `Connection error${error ? ': ' + error : ''}`
  }

  return (
    <div className={`db-pill ${cls}`}>
      <div className="dot" />
      <span>{text}</span>
    </div>
  )
}
