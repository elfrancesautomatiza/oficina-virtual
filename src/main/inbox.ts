// Boîte de réception par agent (inbox/) et calcul des pastilles.
import fs from 'fs'
import path from 'path'
import type { AgentAlerts, InboxItem, InboxKind } from '../shared/types'
import { agentDir, loadOffice, loadSession, listOffices, readJson, writeJson } from './store'
import { unreadReports } from './reports'

interface InboxIndex { [file: string]: { read: boolean } }
const inboxPath = (o: string, slug: string): string => path.join(agentDir(o, slug), 'inbox')
const indexFile = (o: string, slug: string): string => path.join(inboxPath(o, slug), 'index.json')

function parseHead(file: string): { kind: InboxKind; title: string } {
  let kind: InboxKind = 'info'
  let title = path.basename(file, '.md')
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').slice(0, 12)
    for (const l of lines) {
      const m = l.match(/^kind:\s*(question|info)/i)
      if (m) kind = m[1].toLowerCase() as InboxKind
      if (l.trim().startsWith('#') && title === path.basename(file, '.md')) title = l.replace(/^#+\s*/, '').trim()
      if (/\?\s*$/.test(title) && kind === 'info') kind = 'question'
    }
  } catch { /* ignore */ }
  return { kind, title }
}

export function listInbox(o: string, slug: string): InboxItem[] {
  const dir = inboxPath(o, slug)
  if (!fs.existsSync(dir)) return []
  const idx = readJson<InboxIndex>(indexFile(o, slug), {})
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse().map((f) => {
    const full = path.join(dir, f)
    const { kind, title } = parseHead(full)
    return { office: o, agentSlug: slug, file: f, kind, title, at: fs.statSync(full).mtime.toISOString(), read: !!idx[f]?.read }
  })
}

export function readInbox(o: string, slug: string, file: string): string {
  const f = path.join(inboxPath(o, slug), path.basename(file))
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}

export function markInboxRead(o: string, slug: string, file: string): void {
  const idx = readJson<InboxIndex>(indexFile(o, slug), {})
  idx[path.basename(file)] = { read: true }
  writeJson(indexFile(o, slug), idx)
}

/** Le dernier message de l'agent est-il une question non encore vue ? */
export function pendingQuestion(o: string, slug: string): boolean {
  const s = loadSession(o, slug)
  const last = [...s.messages].reverse().find((m) => m.role === 'assistant' || m.role === 'user')
  if (!last || last.role !== 'assistant') return false
  if (s.lastSeenAt && s.lastSeenAt >= last.at) return false
  const tail = last.text.trim().slice(-400)
  return /\?\s*$/.test(tail) || /\?\s*\n/.test(tail)
}

export function agentAlerts(o: string, slug: string): AgentAlerts {
  const inbox = listInbox(o, slug).filter((i) => !i.read)
  const a: AgentAlerts = {
    inboxQuestions: inbox.filter((i) => i.kind === 'question').length,
    inboxInfos: inbox.filter((i) => i.kind === 'info').length,
    unreadReports: unreadReports(o, slug).length,
    pendingQuestion: pendingQuestion(o, slug),
    total: 0
  }
  a.total = a.inboxQuestions + a.inboxInfos + a.unreadReports + (a.pendingQuestion ? 1 : 0)
  return a
}

export function officeAlerts(o: string): Record<string, AgentAlerts> {
  const out: Record<string, AgentAlerts> = {}
  for (const a of loadOffice(o).agents) out[a.slug] = agentAlerts(o, a.slug)
  return out
}

/** Total par bureau, pour la porte et la barre du haut. */
export function allAlerts(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of listOffices()) out[m.slug] = Object.values(officeAlerts(m.slug)).reduce((n, a) => n + a.total, 0)
  return out
}
