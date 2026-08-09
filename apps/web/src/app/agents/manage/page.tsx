'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { AgentConfigPanel } from '@/components/AgentConfigPanel'

interface AgentSummary {
  id: string
  name: string
  defaultName?: string
  role: string
}

type EditorTab = 'config' | 'instructions' | 'workflow'

export default function AgentsManagePage() {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<EditorTab>('config')

  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [workflowContent, setWorkflowContent] = useState('')
  const [savedWorkflowContent, setSavedWorkflowContent] = useState('')
  const [workflowFile, setWorkflowFile] = useState<string | null>(null)

  const [loadingList, setLoadingList] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [savedDisplayName, setSavedDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)

  const displayNamesQuery = trpc.settings.agentDisplayNames.get.useQuery()
  const setDisplayNameMutation = trpc.settings.agentDisplayNames.set.useMutation({
    onSuccess: () => {
      void displayNamesQuery.refetch()
    },
  })

  const isInstructionsDirty = content !== savedContent
  const isWorkflowDirty = workflowContent !== savedWorkflowContent
  const isDirty = isInstructionsDirty || isWorkflowDirty
  const isNameDirty = displayName.trim() !== savedDisplayName.trim()
  const selected = agents.find((a) => a.id === selectedId)
  const defaultName = selected?.defaultName ?? selected?.name ?? ''
  // The config tab saves through its own panel, so it never drives the file Save button.
  const activeDirty =
    tab === 'instructions' ? isInstructionsDirty : tab === 'workflow' ? isWorkflowDirty : false
  const hasWorkflow = !!workflowFile

  useEffect(() => {
    async function loadAgents() {
      try {
        const res = await fetch('/api/agents')
        if (!res.ok) throw new Error('Failed to load agents')
        const data = (await res.json()) as { agents: AgentSummary[] }
        setAgents(data.agents)
        if (data.agents[0]) setSelectedId(data.agents[0].id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'שגיאה בטעינת סוכנים')
      } finally {
        setLoadingList(false)
      }
    }
    loadAgents()
  }, [])

  const loadAgentContent = useCallback(async (agentId: string) => {
    setLoadingContent(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`)
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to load agent content')
      }
      const data = (await res.json()) as {
        content: string
        workflowFile: string | null
        workflowContent: string | null
      }
      setContent(data.content)
      setSavedContent(data.content)
      setWorkflowFile(data.workflowFile)
      const wf = data.workflowContent ?? ''
      setWorkflowContent(wf)
      setSavedWorkflowContent(wf)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בטעינת הוראות')
      setContent('')
      setSavedContent('')
      setWorkflowFile(null)
      setWorkflowContent('')
      setSavedWorkflowContent('')
    } finally {
      setLoadingContent(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId) loadAgentContent(selectedId)
  }, [selectedId, loadAgentContent])

  useEffect(() => {
    if (!selectedId) return
    const custom = displayNamesQuery.data?.rawNames?.[selectedId] ?? ''
    setDisplayName(custom)
    setSavedDisplayName(custom)
  }, [selectedId, displayNamesQuery.data?.rawNames])

  async function handleSaveDisplayName() {
    if (!selectedId || !isNameDirty) return
    setSavingName(true)
    setError(null)
    setMessage(null)
    try {
      const trimmed = displayName.trim()
      await setDisplayNameMutation.mutateAsync({
        agentId: selectedId,
        displayName: trimmed || null,
      })
      setSavedDisplayName(trimmed)
      const displayOnly = trimmed.split(/[|/]/)[0]?.trim() || defaultName
      setAgents((prev) =>
        prev.map((a) =>
          a.id === selectedId
            ? { ...a, name: displayOnly, defaultName }
            : a,
        ),
      )
      setMessage(trimmed ? 'שם התצוגה נשמר' : 'שם התצוגה אופס לברירת מחדל')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשמירת שם')
    } finally {
      setSavingName(false)
    }
  }

  async function handleSave() {
    if (!selectedId || !activeDirty) return
    if (tab === 'workflow' && !hasWorkflow) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const payload =
        tab === 'workflow'
          ? { content: workflowContent, target: 'workflow' as const }
          : { content, target: 'instructions' as const }
      const res = await fetch(`/api/agents/${encodeURIComponent(selectedId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to save')
      }
      if (tab === 'workflow') {
        setSavedWorkflowContent(workflowContent)
        setMessage('ה-workflow נשמר ל-S_Skills/')
      } else {
        setSavedContent(content)
        setMessage('ההוראות נשמרו ל-A_Agents/')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשמירה')
    } finally {
      setSaving(false)
    }
  }

  function handleSelectAgent(agentId: string) {
    if (isDirty && !window.confirm('יש שינויים שלא נשמרו. להמשיך בלי לשמור?')) {
      return
    }
    setSelectedId(agentId)
  }

  function handleTabChange(next: EditorTab) {
    if (next === tab) return
    if (activeDirty && !window.confirm('יש שינויים שלא נשמרו בטאב הנוכחי. להמשיך בלי לשמור?')) {
      return
    }
    setTab(next)
    setMessage(null)
  }

  const fileLabel =
    tab === 'config'
      ? 'טריגרים — לוח זמנים ואירועים'
      : tab === 'workflow'
        ? workflowFile
          ? `S_Skills/${workflowFile}`
          : 'אין workflow מקושר'
        : selected
          ? `A_Agents/${selected.id}.md`
          : ''

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100dvh-4rem)]">
      <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ניהול סוכנים</h1>
          <p className="text-xs text-[#5a688c] mt-1">
            הגדרת טריגרים (שעות ואירועים), עריכת כרטיס סוכן (A_Agents) ו-workflow מקושר (S_Skills)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-xs text-[#2dd4bf]">שינויים שלא נשמרו</span>
          )}
          <Link href="/agents" className="btn btn-ghost text-sm">
            צ&apos;אט סוכנים
          </Link>
        </div>
      </div>

      {message && (
        <div className="mb-3 text-sm text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-3 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loadingList && (
        <div className="flex-1 flex items-center justify-center text-[#5a688c] text-sm">
          טוען סוכנים...
        </div>
      )}

      {!loadingList && agents.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-[#5a688c] text-sm">
          לא נמצאו סוכנים ב-A_Agents/
        </div>
      )}

      {!loadingList && agents.length > 0 && (
        <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
          <div className="lg:w-64 shrink-0 flex flex-col gap-2">
            <label className="text-xs text-[#5a688c] lg:hidden">בחר סוכן</label>
            <select
              className="lg:hidden bg-[#111b30] border border-[#29395d] rounded-lg px-3 py-2 text-sm text-[#eef3fb]"
              value={selectedId ?? ''}
              onChange={(e) => handleSelectAgent(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <div className="hidden lg:flex flex-col gap-1 border border-[#1d2b46] rounded-xl p-2 overflow-y-auto">
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handleSelectAgent(a.id)}
                  className={`text-right rounded-lg px-3 py-2.5 transition-colors ${
                    selectedId === a.id
                      ? 'bg-[#2dd4bf]/15 border border-[#2dd4bf]/30 text-[#eef3fb]'
                      : 'hover:bg-[#1d2b46] text-[#97a4c2] border border-transparent'
                  }`}
                >
                  <div className="font-medium text-sm">{a.name}</div>
                  {a.role && (
                    <div className="text-[11px] text-[#5a688c] mt-0.5 line-clamp-2">{a.role}</div>
                  )}
                  <div className="text-[10px] text-[#4d659c] mt-1 font-mono">{a.id}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 flex flex-col border border-[#1d2b46] rounded-xl overflow-hidden min-h-[400px]">
            <div className="px-4 py-3 border-b border-[#1d2b46] bg-[#111b30] space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-medium text-sm">{selected?.name ?? 'בחר סוכן'}</div>
                  {selected && (
                    <div className="text-[10px] text-[#5a688c] font-mono mt-0.5">{fileLabel}</div>
                  )}
                </div>
                {tab !== 'config' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      !selectedId ||
                      !activeDirty ||
                      saving ||
                      loadingContent ||
                      (tab === 'workflow' && !hasWorkflow)
                    }
                    onClick={handleSave}
                  >
                    {saving
                      ? 'שומר...'
                      : tab === 'workflow'
                        ? 'שמור workflow'
                        : 'שמור הוראות'}
                  </button>
                )}
              </div>

              {selectedId && (
                <div className="flex gap-1 p-0.5 rounded-lg bg-[#0a1224] border border-[#1d2b46] w-fit">
                  <button
                    type="button"
                    onClick={() => handleTabChange('config')}
                    className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                      tab === 'config'
                        ? 'bg-[#2dd4bf]/20 text-[#eef3fb]'
                        : 'text-[#97a4c2] hover:text-[#eef3fb]'
                    }`}
                  >
                    הגדרות והרצה
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTabChange('instructions')}
                    className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                      tab === 'instructions'
                        ? 'bg-[#2dd4bf]/20 text-[#eef3fb]'
                        : 'text-[#97a4c2] hover:text-[#eef3fb]'
                    }`}
                  >
                    כרטיס סוכן
                    {isInstructionsDirty ? ' •' : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTabChange('workflow')}
                    className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                      tab === 'workflow'
                        ? 'bg-[#2dd4bf]/20 text-[#eef3fb]'
                        : 'text-[#97a4c2] hover:text-[#eef3fb]'
                    }`}
                  >
                    Workflow
                    {isWorkflowDirty ? ' •' : ''}
                  </button>
                </div>
              )}

              {selectedId && (
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <label className="flex-1">
                    <span className="block text-xs text-[#5a688c] mb-1">שם תצוגה (בממשק, התראות, וואטסאפ)</span>
                    <input
                      type="text"
                      className="input w-full text-sm"
                      value={displayName}
                      maxLength={40}
                      placeholder={defaultName}
                      onChange={(e) => {
                        setDisplayName(e.target.value)
                        setMessage(null)
                      }}
                    />
                    <span className="block text-[10px] text-[#4d659c] mt-1">
                      שם מקורי: {defaultName}
                      {' · '}ניתן להוסיף כינוי באנגלית עם | (למשל: טמפו | tempo)
                    </span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost text-sm shrink-0"
                    disabled={!isNameDirty || savingName}
                    onClick={handleSaveDisplayName}
                  >
                    {savingName ? 'שומר...' : 'שמור שם'}
                  </button>
                </div>
              )}
            </div>

            {!selectedId ? (
              <div className="flex-1 flex items-center justify-center text-[#5a688c] text-sm">
                בחר סוכן לעריכה
              </div>
            ) : tab === 'config' ? (
              <AgentConfigPanel agentId={selectedId} />
            ) : loadingContent ? (
              <div className="flex-1 flex items-center justify-center text-[#5a688c] text-sm">
                טוען...
              </div>
            ) : tab === 'workflow' && !hasWorkflow ? (
              <div className="flex-1 flex items-center justify-center text-[#5a688c] text-sm px-6 text-center">
                אין workflow מקושר לסוכן הזה ב-S_Skills/
              </div>
            ) : tab === 'workflow' ? (
              <textarea
                className="input flex-1 resize-none rounded-none border-0 font-mono text-xs leading-relaxed p-4 min-h-0"
                dir="ltr"
                spellCheck={false}
                value={workflowContent}
                onChange={(e) => {
                  setWorkflowContent(e.target.value)
                  setMessage(null)
                }}
                placeholder="תוכן markdown של ה-workflow..."
              />
            ) : (
              <textarea
                className="input flex-1 resize-none rounded-none border-0 font-mono text-xs leading-relaxed p-4 min-h-0"
                dir="ltr"
                spellCheck={false}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setMessage(null)
                }}
                placeholder="תוכן markdown של הסוכן..."
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
