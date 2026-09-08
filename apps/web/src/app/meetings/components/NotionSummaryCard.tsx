'use client'

import { useState } from 'react'
import {
  headingEmoji,
  NOTION_SUMMARY_PREVIEW_BLOCKS,
  parseNotionSummary,
  type NotionSummaryBlock,
} from '@/lib/notion-summary-format'

export type NotionSummaryNote = {
  id: string
  title: string
  date?: string | null
  snippet: string | null
  bodyText?: string | null
  notionUrl: string | null
  sourceKind?: string | null
}

function BlockView({ block }: { block: NotionSummaryBlock }) {
  if (block.kind === 'heading') {
    const Tag = block.level === 1 ? 'h3' : 'h4'
    return (
      <Tag
        className={
          block.level === 1
            ? 'text-sm font-semibold text-[#eef3fb] pt-3 first:pt-0 flex items-center gap-2'
            : 'text-[13px] font-semibold text-[#c5d0e6] pt-2 first:pt-0'
        }
      >
        {block.level === 1 ? <span className="text-[#2dd4bf] shrink-0">{headingEmoji(block.text)}</span> : null}
        {block.text}
      </Tag>
    )
  }

  if (block.kind === 'labeled') {
    return (
      <div className="rounded-lg bg-[#16233b] border border-[#2f4368] px-3 py-2.5">
        <div className="text-[11px] font-semibold text-[#2dd4bf] mb-1">{block.label}</div>
        <p className="text-sm text-[#c5d0e6] leading-relaxed">{block.text}</p>
      </div>
    )
  }

  if (block.kind === 'bullet') {
    return (
      <div className="flex gap-2 text-sm text-[#c5d0e6] leading-relaxed">
        <span className="text-[#2dd4bf] shrink-0">•</span>
        <span>{block.text}</span>
      </div>
    )
  }

  if (block.kind === 'numbered') {
    return (
      <div className="flex gap-2 text-sm text-[#c5d0e6] leading-relaxed">
        <span className="text-[#647399] shrink-0 tabular-nums">{block.marker}.</span>
        <span>{block.text}</span>
      </div>
    )
  }

  return <p className="text-sm text-[#97a4c2] leading-relaxed">{block.text}</p>
}

export function NotionSummaryCard({
  note,
  titleHref,
  compact = false,
}: {
  note: NotionSummaryNote
  titleHref?: string | null
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const content = note.bodyText?.trim() || note.snippet?.trim() || ''
  const blocks = parseNotionSummary(content)
  const isPageNotes = Boolean(note.sourceKind?.startsWith('meeting_page'))
  const previewCount = compact ? 4 : NOTION_SUMMARY_PREVIEW_BLOCKS
  const isLong = blocks.length > previewCount
  const visible = isLong && !expanded ? blocks.slice(0, previewCount) : blocks
  const href = titleHref || note.notionUrl

  return (
    <article className="py-3 border-b border-[#223052] last:border-0">
      <div className="flex items-start justify-between gap-2 mb-2">
        {href ? (
          <a
            href={href}
            target={titleHref ? undefined : '_blank'}
            rel={titleHref ? undefined : 'noreferrer'}
            className="text-sm font-medium text-[#eef3fb] hover:text-[#2dd4bf] transition-colors"
          >
            {note.title}
          </a>
        ) : (
          <div className="text-sm font-medium text-[#eef3fb]">{note.title}</div>
        )}
        {isPageNotes ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0 bg-[#8b5cf6]/15 text-[#b794f6] border border-[#8b5cf6]/25">
            מדף הפגישה ב-Notion
          </span>
        ) : null}
      </div>

      {note.date ? (
        <div className="text-[11px] text-[#5a688c] mb-2">
          {new Date(note.date + 'T00:00:00').toLocaleDateString('he-IL')}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className="space-y-2">{visible.map((block, i) => <BlockView key={i} block={block} />)}</div>
      ) : null}

      {isLong ? (
        <button
          type="button"
          className="mt-3 text-sm font-medium text-[#38bdf8] hover:text-[#5eead4] transition-colors"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '‹ צמצם' : 'קרא עוד ›'}
        </button>
      ) : null}
    </article>
  )
}
