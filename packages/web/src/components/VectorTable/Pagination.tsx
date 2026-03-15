import React from 'react'
import { useAppDispatch, useAppSelector } from '../../store'
import { setPage } from '../../store/uiSlice'
import { selectFiltered } from '../../store'
import { PAGE_SIZE } from '../../config'

export default function Pagination() {
  const dispatch = useAppDispatch()
  const page = useAppSelector(s => s.ui.page)
  const filtered = useAppSelector(selectFiltered)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  if (totalPages <= 1) return null

  const WIN = 10
  const winStart = Math.floor(page / WIN) * WIN
  const winEnd = Math.min(winStart + WIN, totalPages)

  const go = (p: number) => dispatch(setPage(p))

  return (
    <div className="pagination">
      <button disabled={page === 0} onClick={() => go(page - 1)}>&#8592;</button>
      {winStart > 0 && (
        <button onClick={() => go(winStart - WIN)}>&#171;</button>
      )}
      {Array.from({ length: winEnd - winStart }, (_, i) => winStart + i).map(i => (
        <button
          key={i}
          className={i === page ? 'active' : ''}
          onClick={() => go(i)}
        >
          {i + 1}
        </button>
      ))}
      {winEnd < totalPages && (
        <button onClick={() => go(winEnd)}>&#187;</button>
      )}
      <button disabled={page === totalPages - 1} onClick={() => go(page + 1)}>&#8594;</button>
      <span className="page-info">{page + 1} / {totalPages}</span>
    </div>
  )
}
