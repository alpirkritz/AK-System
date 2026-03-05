'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import dynamic from 'next/dynamic'
const PersonModal = dynamic(() => import('@/components/Modals/PersonModal').then((m) => m.PersonModal), { ssr: false })

export default function PeoplePage() {
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const meetingsWithPeople = meetings as Array<{ id: string; peopleIds?: string[] }>

  return (
    <div>
      <div className="flex justify-between items-center mb-7">
        <h1 className="text-2xl font-bold tracking-tight">אנשים</h1>
        <button className="btn btn-primary" onClick={() => { setEditingId(null); setModalOpen(true); }}>
          + הוסף איש קשר
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {people.map((p) => {
          const theirMeetings = meetingsWithPeople.filter((m) => (m.peopleIds ?? []).includes(p.id))
          return (
            <div
              key={p.id}
              className="card cursor-pointer"
              onClick={() => { setEditingId(p.id); setModalOpen(true); }}
            >
              <div className="flex gap-3 items-center mb-3.5">
                <div
                  className="avatar w-11 h-11 text-lg border-2"
                  style={{
                    background: (p.color ?? '#e8c547') + '22',
                    color: p.color ?? '#e8c547',
                    borderColor: (p.color ?? '#e8c547') + '33',
                  }}
                >
                  {p.name[0]}
                </div>
                <div>
                  <div className="font-semibold text-[15px]">{p.name}</div>
                  <div className="text-xs text-[#666]">{p.role}</div>
                </div>
              </div>
              <div className="text-xs text-[#555] mb-2">{p.email}</div>
              <div className="border-t border-[#1f1f1f] pt-2.5">
                <span className="text-xs text-[#666]">◈ {theirMeetings.length} פגישות</span>
              </div>
            </div>
          )
        })}
      </div>
      <PersonModal open={modalOpen} onClose={() => { setModalOpen(false); setEditingId(null); }} editingId={editingId} />
    </div>
  )
}
