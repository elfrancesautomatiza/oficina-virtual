// Messagerie : une conversation par agent, tous bureaux confondus, la plus récente en haut (agents épinglés en premier).
// Lu / non lu : questions + infos de la boîte de réception, rapports non lus, réponses de l'agent depuis la dernière
// ouverture, plus un « non lu » posé à la main (stocké dans messagerie.json à la racine).
import fs from 'fs'
import path from 'path'
import type { ConversationSummary, ThreadItem } from '../shared/types'
import { listOffices, loadOffice, loadSession, markSeen, projectRoot, readJson, writeJson, agentDir } from './store'
import { listInbox, readInbox, markInboxRead } from './inbox'
import { stripVoicePrefix } from '../shared/voice'
import { listReports, readReport, markRead as markReportRead } from './reports'

interface ReadState { unread: Record<string, boolean> }
const stateFile = (): string => path.join(projectRoot(), 'messagerie.json')
const k = (o: string, slug: string): string => `${o}/${slug}`

function loadState(): ReadState { return readJson<ReadState>(stateFile(), { unread: {} }) }

const clean = (t: string, n = 120): string =>
  t.replace(/^kind:.*$/gim, '').replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim().slice(0, n)

function reportAt(o: string, slug: string, file: string, fallback: string): string {
  try { return fs.statSync(path.join(agentDir(o, slug), 'reports', file)).mtime.toISOString() } catch { return fallback }
}

export function listConversations(): ConversationSummary[] {
  const st = loadState()
  const allReports = new Map<string, ReturnType<typeof listReports>>()
  const out: ConversationSummary[] = []
  for (const meta of listOffices()) {
    const office = loadOffice(meta.slug)
    if (!allReports.has(meta.slug)) allReports.set(meta.slug, listReports(meta.slug))
    for (const a of office.agents) {
      const s = loadSession(meta.slug, a.slug)
      const msgs = s.messages.filter((m) => m.role !== 'tool' && m.text?.trim())
      const lastMsg = msgs[msgs.length - 1]
      const inbox = listInbox(meta.slug, a.slug)
      const lastInbox = [...inbox].sort((x, y) => (x.at < y.at ? 1 : -1))[0]
      const reps = (allReports.get(meta.slug) ?? []).filter((r) => r.agentSlug === a.slug)
      const lastRep = reps.sort((x, y) => (x.date < y.date ? 1 : -1))[0]
      const cands: Array<{ at: string; preview: string; from: ConversationSummary['previewFrom'] }> = []
      if (lastMsg) cands.push({ at: lastMsg.at, preview: stripVoicePrefix(lastMsg.text), from: lastMsg.role === 'user' ? 'moi' : lastMsg.role === 'assistant' ? 'agent' : 'systeme' })
      if (lastInbox) cands.push({ at: lastInbox.at, preview: lastInbox.title, from: lastInbox.kind })
      if (lastRep) cands.push({ at: reportAt(meta.slug, a.slug, lastRep.file, lastRep.date), preview: lastRep.title, from: 'rapport' })
      const best = cands.sort((x, y) => (x.at < y.at ? 1 : -1))[0]
      const seen = s.lastSeenAt ?? ''
      const newAnswers = msgs.filter((m) => m.role === 'assistant' && m.at > seen).length
      const unreadInbox = inbox.filter((i) => !i.read)
      const unreadReps = reps.filter((r) => !r.read).length
      out.push({
        office: meta.slug, officeName: meta.name, officeColor: meta.color, officeHidden: !!meta.hidden,
        slug: a.slug, name: a.name, role: a.job || a.role, avatar: a.avatar, color: a.color, pinned: !!a.pinned,
        lastAt: best?.at ?? a.createdAt ?? '', preview: clean(best?.preview ?? a.tagline ?? ''), previewFrom: best?.from ?? '',
        unread: unreadInbox.length + unreadReps + newAnswers,
        manualUnread: !!st.unread[k(meta.slug, a.slug)],
        question: unreadInbox.some((i) => i.kind === 'question'),
        seenAt: seen
      })
    }
  }
  return out.sort((x, y) => (x.pinned !== y.pinned ? (x.pinned ? -1 : 1) : x.lastAt < y.lastAt ? 1 : -1))
}

/** Le titre est déjà affiché sur la carte : on retire la 1re ligne « # … ». */
const sansTitre = (t: string): string => t.trim().replace(/^#{1,3}\s+.*\n+/, '').trim()

/** Fil complet : messages + questions/infos + rapports, du plus ancien au plus récent (les `limit` derniers). */
export function getThread(o: string, slug: string, limit = 150): ThreadItem[] {
  const items: ThreadItem[] = []
  for (const m of loadSession(o, slug).messages) {
    if (!m.text?.trim()) continue
    items.push({ id: m.id, kind: m.role, text: m.role === 'user' ? stripVoicePrefix(m.text) : m.text, at: m.at })
  }
  for (const i of listInbox(o, slug)) {
    items.push({ id: `inbox:${i.file}`, kind: i.kind, title: i.title, text: sansTitre(readInbox(o, slug, i.file).replace(/^kind:.*\n?/im, '')), file: i.file, at: i.at, read: i.read })
  }
  for (const r of listReports(o).filter((r) => r.agentSlug === slug)) {
    items.push({ id: `report:${r.file}`, kind: 'report', title: r.title, text: sansTitre(readReport(o, slug, r.file)), file: r.file, at: reportAt(o, slug, r.file, r.date), read: r.read })
  }
  return items.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)).slice(-limit)
}

export function setConversationUnread(o: string, slug: string, unread: boolean): void {
  const st = loadState()
  if (unread) st.unread[k(o, slug)] = true
  else delete st.unread[k(o, slug)]
  writeJson(stateFile(), st)
}

/** Ouvrir une conversation = tout est lu, comme WhatsApp. */
export function markConversationRead(o: string, slug: string): void {
  markSeen(o, slug)
  for (const i of listInbox(o, slug)) if (!i.read) markInboxRead(o, slug, i.file)
  for (const r of listReports(o)) if (r.agentSlug === slug && !r.read) markReportRead(o, slug, r.file)
  setConversationUnread(o, slug, false)
}
