'use client'

import { useState, type ReactNode } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, EyeOff, GripVertical, RotateCcw } from 'lucide-react'
import type { LayoutScreen } from '@ak-system/types'
import { cn } from '@/lib/cn'
import { pairSpans } from './spans'
import { useLayout } from './useLayout'

/** What a block can read and report back: whether the owner left it open or closed. */
export type BlockState = { open: boolean | undefined; onToggle: (open: boolean) => void }

export type LayoutBlock = {
  id: string
  /** Shown on the drag strip and in the hidden tray. */
  label: string
  node: ReactNode | ((state: BlockState) => ReactNode)
  /**
   * Two adjacent half blocks sit side by side on wide screens; a half block with no half
   * neighbour takes the full width.
   */
  half?: boolean
}

function SortableBlock({
  block, editing, span, onHide, state,
}: { block: LayoutBlock; editing: boolean; span: 1 | 2; onHide: () => void; state: BlockState }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled: !editing,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'min-w-0 max-w-full',
        span === 2 ? 'lg:col-span-2' : 'lg:col-span-1',
        editing && 'rounded-xl border border-dashed border-[#3a4b73] p-2',
        isDragging && 'relative z-10 opacity-80 shadow-lg',
      )}
      data-testid={`layout-block-${block.id}`}
    >
      {editing && (
        <div className="flex items-center gap-2 mb-2 text-xs text-[#97a4c2]">
          <button
            type="button"
            className="touch-none cursor-grab active:cursor-grabbing rounded p-1 hover:bg-[#1f2d4a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2dd4bf]"
            aria-label={`גרור להזזת ${block.label}. רווח להרמה, חצים להזזה`}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </button>
          <span className="font-semibold">{block.label}</span>
          <button
            type="button"
            className="ms-auto inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-[#1f2d4a]"
            onClick={onHide}
            aria-label={`הסתר ${block.label}`}
          >
            <EyeOff size={14} /> הסתר
          </button>
        </div>
      )}
      <div className={cn(editing && 'pointer-events-none select-none opacity-90')}>{typeof block.node === 'function' ? block.node(state) : block.node}</div>
    </div>
  )
}

/**
 * Renders a screen's blocks in the owner's saved order. "סדר מחדש" turns on drag handles, hide
 * buttons and a tray for hidden blocks; every change is saved at once.
 */
export function ReorderableBlocks({
  screen, blocks, className, toolbarClassName, tightGap = false,
}: {
  screen: LayoutScreen
  blocks: LayoutBlock[]
  className?: string
  toolbarClassName?: string
  /** For blocks that carry their own bottom margin (the person drawer). */
  tightGap?: boolean
}) {
  const layout = useLayout(screen, blocks.map((b) => b.id))
  const [editing, setEditing] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const visible = layout.visible.map((id) => byId.get(id)!).filter(Boolean)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = layout.visible.indexOf(String(active.id))
    const to = layout.visible.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    layout.saveOrder(arrayMove(layout.visible, from, to))
  }

  const spans = pairSpans(visible.map((b) => !!b.half))

  return (
    <div>
      <div className={cn('flex flex-wrap items-center gap-2 mb-3', toolbarClassName)}>
        <button
          type="button"
          className={cn('btn text-xs py-1 px-3', editing ? 'btn-primary' : 'btn-ghost')}
          aria-pressed={editing}
          onClick={() => setEditing((v) => !v)}
          data-testid="layout-edit-toggle"
        >
          {editing ? 'סיום' : 'סדר מחדש'}
        </button>
        {editing && layout.isCustom && (
          <button
            type="button"
            className="btn btn-ghost text-xs py-1 px-3 inline-flex items-center gap-1"
            onClick={() => { if (window.confirm('לאפס את הסדר והבלוקים המוסתרים?')) layout.reset() }}
          >
            <RotateCcw size={13} /> חזרה לברירת מחדל
          </button>
        )}
      </div>

      {editing && layout.hidden.length > 0 && (
        <div className="card p-3 mb-3 text-xs" data-testid="layout-hidden-tray">
          <div className="font-semibold text-[#97a4c2] mb-2">בלוקים מוסתרים</div>
          <div className="flex flex-wrap gap-2">
            {layout.hidden.map((id) => (
              <button
                key={id}
                type="button"
                className="filter-chip inline-flex items-center gap-1"
                onClick={() => layout.show(id)}
                aria-label={`החזר ${byId.get(id)?.label ?? id}`}
              >
                <Eye size={13} /> {byId.get(id)?.label ?? id}
              </button>
            ))}
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={layout.visible} strategy={rectSortingStrategy}>
          <div className={cn('grid grid-cols-1 lg:grid-cols-2', !layout.ready && 'invisible', tightGap ? 'gap-0' : 'gap-4 md:gap-6', className)}>
            {visible.map((block, i) => (
              <SortableBlock
                key={block.id}
                block={block}
                editing={editing}
                span={spans[i]!}
                onHide={() => layout.hide(block.id)}
                state={{ open: layout.isOpen(block.id), onToggle: (open) => layout.setOpen(block.id, open) }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
