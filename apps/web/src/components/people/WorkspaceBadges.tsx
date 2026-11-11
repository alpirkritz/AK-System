'use client'

import { relationshipLabel, type Affiliation } from './affiliations'

/** One pill per life domain: workspace name in its color, then the relationship there. */
export function WorkspaceBadges({ affiliations, max = 3 }: { affiliations: Affiliation[]; max?: number }) {
  if (affiliations.length === 0) return null
  const shown = affiliations.slice(0, max)
  const hidden = affiliations.length - shown.length
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="workspace-badges">
      {shown.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1 max-w-full text-[11px] leading-5 px-2 rounded-full border border-[#2f4368] bg-[#1d2b46]"
          title={a.reportsToName ? `${a.workspaceName} · ${relationshipLabel(a.relationshipType)} · מדווח ל: ${a.reportsToName}` : undefined}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: a.workspaceColor ?? '#2dd4bf' }} aria-hidden />
          <span className="font-medium text-[#eef3fb] truncate">{a.workspaceName}</span>
          <span className="text-[#97a4c2] truncate">{relationshipLabel(a.relationshipType)}</span>
        </span>
      ))}
      {hidden > 0 && (
        <span className="text-[11px] leading-5 px-1.5 rounded-full bg-[#1d2b46] text-[#97a4c2]">+{hidden}</span>
      )}
    </div>
  )
}
