import { useRef } from 'react'
import { useAppDispatch } from '../../store'
import { setColOrder } from '../../store/uiSlice'

export function useColumnDrag(colOrder: string[]) {
  const dispatch = useAppDispatch()
  const dragSrcIdx = useRef<number | null>(null)

  const dragProps = (idx: number) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent<HTMLTableCellElement>) => {
      dragSrcIdx.current = idx
      ;(e.currentTarget as HTMLElement).style.opacity = '0.45'
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: (e: React.DragEvent<HTMLTableCellElement>) => {
      ;(e.currentTarget as HTMLElement).style.opacity = ''
    },
    onDragOver: (e: React.DragEvent<HTMLTableCellElement>) => {
      e.preventDefault()
      e.currentTarget.classList.add('drag-over')
    },
    onDragLeave: (e: React.DragEvent<HTMLTableCellElement>) => {
      e.currentTarget.classList.remove('drag-over')
    },
    onDrop: (e: React.DragEvent<HTMLTableCellElement>) => {
      e.preventDefault()
      e.currentTarget.classList.remove('drag-over')
      const tgt = idx
      if (dragSrcIdx.current === null || dragSrcIdx.current === tgt) return
      const next = [...colOrder]
      next.splice(tgt, 0, next.splice(dragSrcIdx.current, 1)[0])
      dragSrcIdx.current = null
      dispatch(setColOrder(next))
    },
  })

  return { dragProps }
}
