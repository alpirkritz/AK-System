'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'

/**
 * "אנשים מסלאק" — link each Slack member to a person in AK (docs/specs/local-chat-cache-ingest.md).
 * Exact email / unique name matches are linked automatically by the bridge; this is the rest.
 */
export function SlackPeoplePanel() {
  const utils = trpc.useUtils()
  const { data: unlinked = [], isLoading } = trpc.slack.listMembers.useQuery({ linked: false })
  const { data: linked = [] } = trpc.slack.listMembers.useQuery({ linked: true })
  const [showLinked, setShowLinked] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = async () => {
    await utils.slack.listMembers.invalidate()
    await utils.commitments.invalidate()
  }
  const onDone = (text: string) => async () => {
    setMessage(text)
    await refresh()
  }
  const link = trpc.slack.linkMember.useMutation({ onSuccess: onDone('קושר.'), onError: (e) => setMessage(e.message) })
  const create = trpc.slack.createPersonFromMember.useMutation({ onSuccess: onDone('נוצר איש קשר וקושר.'), onError: (e) => setMessage(e.message) })
  const ignore = trpc.slack.ignoreMember.useMutation({ onSuccess: refresh })
  const unlink = trpc.slack.unlinkMember.useMutation({ onSuccess: refresh })

  if (isLoading) return <p className="text-[#888] text-sm">טוען...</p>

  return (
    <div className="space-y-3" data-testid="slack-people-panel">
      <p className="text-xs text-[#888]">
        כל הודעה בסלאק — גם בערוצים — משויכת לאדם ששלח אותה. קשר כאן משתמשי סלאק לאנשים במערכת. מייל או שם זהה מקושרים אוטומטית.
      </p>
      {message && <p className="text-xs text-[#e8c547]">{message}</p>}

      {unlinked.length === 0 ? (
        <div className="card p-4 text-sm text-[#888]">כל משתמשי הסלאק שראינו כבר מקושרים.</div>
      ) : (
        unlinked.map((m) => (
          <MemberRow
            key={m.userId}
            member={m}
            busy={link.isPending || create.isPending}
            onLink={(personId) => link.mutate({ slackUserId: m.userId, personId })}
            onCreate={() => create.mutate({ slackUserId: m.userId })}
            onIgnore={() => ignore.mutate({ slackUserId: m.userId })}
          />
        ))
      )}

      <button className="text-xs text-[#888] hover:text-[#f0ede6]" onClick={() => setShowLinked((v) => !v)}>
        {showLinked ? '▲' : '▼'} מקושרים ({linked.length})
      </button>
      {showLinked &&
        linked.map((m) => (
          <div key={m.userId} className="card p-3 flex items-center gap-3 text-sm">
            <div className="flex-1 min-w-0">
              <p className="text-[#f0ede6] truncate">{m.name}</p>
              <p className="text-xs text-[#888] truncate">
                ←{' '}
                <Link href={`/people?person=${m.personId}`} className="text-teal-300 hover:underline">
                  {m.personName}
                </Link>
              </p>
            </div>
            <button className="btn btn-ghost text-xs" onClick={() => unlink.mutate({ slackUserId: m.userId })}>
              נתק
            </button>
          </div>
        ))}
    </div>
  )
}

function MemberRow({
  member,
  busy,
  onLink,
  onCreate,
  onIgnore,
}: {
  member: { userId: string; name: string; email: string | null; title: string | null; lastMessageTs: number | null }
  busy: boolean
  onLink: (personId: string) => void
  onCreate: () => void
  onIgnore: () => void
}) {
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState(member.name)
  const q = query.trim()
  const { data: found = [] } = trpc.people.search.useQuery({ query: q }, { enabled: picking && q.length > 1 })

  return (
    <div className="card p-3 space-y-2" data-testid="slack-member-row">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[#f0ede6] truncate">{member.name}</p>
          <p className="text-xs text-[#888] truncate">
            {[member.title, member.email].filter(Boolean).join(' · ')}
            {member.lastMessageTs ? ` · הודעה אחרונה ${new Date(member.lastMessageTs).toLocaleDateString('he-IL')}` : ''}
          </p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button className="btn btn-primary text-xs" disabled={busy} onClick={() => setPicking((v) => !v)}>
            קשר לאדם קיים
          </button>
          <button className="btn btn-ghost text-xs" disabled={busy} onClick={onCreate}>
            צור חדש
          </button>
          <button className="btn btn-ghost text-xs" disabled={busy} onClick={onIgnore} title="הסתר מהרשימה">
            התעלם
          </button>
        </div>
      </div>
      {picking && (
        <div className="space-y-1">
          <input className="input text-sm w-full" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חפש אדם..." autoFocus />
          {found
            .filter((p) => p.status !== 'ignored')
            .slice(0, 8)
            .map((p) => (
              <button
                key={p.id}
                className="block w-full text-right text-sm px-2 py-1 rounded hover:bg-[#1b2740] text-[#f0ede6]"
                onClick={() => {
                  setPicking(false)
                  onLink(p.id)
                }}
              >
                {p.name}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
