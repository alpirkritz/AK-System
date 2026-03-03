'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'
import type { Person } from '@ak-system/database'

const COLORS = ['#e8c547', '#e8477a', '#47b8e8', '#47e8a8', '#b847e8']

export function PersonModal({
  open,
  onClose,
  editingId,
}: {
  open: boolean
  onClose: () => void
  editingId: string | null
}) {
  const [form, setForm] = useState<{ name: string; role: string; email: string; color: string }>({
    name: '',
    role: '',
    email: '',
    color: '#e8c547',
  })
  const { data: person } = trpc.people.getById.useQuery({ id: editingId! }, { enabled: !!editingId && open })
  const utils = trpc.useUtils()
  const create = trpc.people.create.useMutation({
    onSuccess: () => { utils.people.list.invalidate(); onClose() },
  })
  const update = trpc.people.update.useMutation({
    onSuccess: () => { utils.people.list.invalidate(); onClose() },
  })

  useEffect(() => {
    if (!open) return
    if (editingId && person) {
      setForm({
        name: person.name,
        role: person.role ?? '',
        email: person.email ?? '',
        color: person.color ?? '#e8c547',
      })
    } else {
      setForm({ name: '', role: '', email: '', color: '#e8c547' })
    }
  }, [open, editingId, person])

  const save = () => {
    if (editingId) {
      update.mutate({ id: editingId, ...form })
    } else {
      create.mutate(form)
    }
  }

  if (!open) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg mb-6 tracking-tight">
          {editingId ? 'ערוך איש קשר' : 'איש קשר חדש'}
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className="label">שם מלא</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="שם"
            />
          </div>
          <div>
            <label className="label">תפקיד</label>
            <input
              className="input"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              placeholder="תפקיד"
            />
          </div>
          <div>
            <label className="label">אימייל</label>
            <input
              className="input"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="email"
            />
          </div>
          <div>
            <label className="label">צבע</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <div
                  key={c}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className="w-7 h-7 rounded-full cursor-pointer border-[3px] border-transparent transition-all"
                  style={{
                    background: c,
                    borderColor: form.color === c ? 'white' : 'transparent',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2.5 mt-6 justify-end">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name || create.isPending || update.isPending}>
            שמור
          </button>
        </div>
      </div>
    </div>
  )
}
