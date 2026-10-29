import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationSummary, RunnerEvent } from '@shared/types'
import { estNonLu } from './ConvList'

/** Liste des conversations, rafraîchie à chaque événement (nouveau message, routine, boîte de réception). */
export function useConversations(): {
  list: ConversationSummary[]
  busy: Record<string, string | undefined>
  refresh: () => Promise<void>
  toggleUnread: (c: ConversationSummary) => Promise<void>
  open: (c: ConversationSummary) => Promise<void>
} {
  const [list, setList] = useState<ConversationSummary[]>([])
  const [busy, setBusy] = useState<Record<string, string | undefined>>({})
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refresh = useCallback(async () => { try { setList(await window.api.listConversations()) } catch { /* hors ligne */ } }, [])
  const later = useCallback(() => { if (t.current) clearTimeout(t.current); t.current = setTimeout(() => { refresh() }, 400) }, [refresh])
  useEffect(() => {
    refresh()
    const offA = window.api.onAlerts(later)
    const offR = window.api.onRoutine((ev) => {
      const k = `${ev.office}/${ev.slug}`
      setBusy((b) => ({ ...b, [k]: ev.status === 'running' ? 'rutina en curso…' : undefined }))
      later()
    })
    const offRun = window.api.onRunner((ev: RunnerEvent) => {
      const k = `${ev.office}/${ev.agentSlug}`
      if (ev.kind === 'start') setBusy((b) => ({ ...b, [k]: 'escribe…' }))
      else if (ev.kind === 'tool') setBusy((b) => ({ ...b, [k]: ev.text ? `${ev.text.slice(0, 40)}…` : 'trabaja…' }))
      else if (ev.kind === 'end') { setBusy((b) => ({ ...b, [k]: undefined })); later() }
    })
    const iv = setInterval(refresh, 60_000)
    return () => { offA(); offR(); offRun(); clearInterval(iv) }
  }, [refresh, later])
  const toggleUnread = useCallback(async (c: ConversationSummary) => {
    if (estNonLu(c)) await window.api.markConversationRead(c.office, c.slug)
    else await window.api.setConversationUnread(c.office, c.slug, true)
    await refresh()
  }, [refresh])
  const open = useCallback(async (c: ConversationSummary) => {
    await window.api.markConversationRead(c.office, c.slug)
    await refresh()
  }, [refresh])
  return { list, busy, refresh, toggleUnread, open }
}
