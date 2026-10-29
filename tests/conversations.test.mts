import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-conv-'))
process.env.BUREAU_ROOT = root
fs.writeFileSync(path.join(root, 'package.json'), '{}')
const mkOffice = (slug: string, hidden = false): void => {
  fs.mkdirSync(path.join(root, 'offices', slug, 'agents'), { recursive: true })
  fs.writeFileSync(path.join(root, 'offices', slug, 'office.json'), JSON.stringify({ slug, name: slug.toUpperCase(), owner: 'M', color: '#000', createdAt: '2026-01-01', ...(hidden ? { hidden: true } : {}) }))
}
const mkAgent = (o: string, slug: string, msgs: Array<[string, string, string]>, extra: Record<string, unknown> = {}, seen?: string): string => {
  const d = path.join(root, 'offices', o, 'agents', slug)
  fs.mkdirSync(path.join(d, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(d, 'agent.json'), JSON.stringify({ slug, name: slug, role: 'r', tagline: '', avatar: {}, desk: { col: 0, row: 0 }, folders: [], allowedTools: [], disallowedTools: [], routines: [], createdAt: '2026-01-01T00:00:00Z', color: '#fff', ...extra }))
  fs.writeFileSync(path.join(d, 'sessions.json'), JSON.stringify({ sessionId: null, lastSeenAt: seen, messages: msgs.map(([role, text, at], i) => ({ id: String(i), role, text, at })) }))
  return d
}
mkOffice('demo'); mkOffice('perso', true)
mkAgent('perso', 'asistente', [['assistant', 'vieux', '2026-10-01T10:00:00Z']], { pinned: true }, '2026-10-02T00:00:00Z')
mkAgent('demo', 'lucia', [['user', 'salut', '2026-10-22T10:00:00Z'], ['assistant', 'réponse', '2026-10-22T10:01:00Z']], {}, '2026-10-22T09:00:00Z')
const carla = mkAgent('demo', 'carla', [], {})
fs.writeFileSync(path.join(carla, 'inbox', '2026-10-22-1200-q.md'), 'kind: question\n# Je publie ?\nA ou B')

const conv = await import('../src/main/conversations')

test('ordre : épinglé en haut puis le plus récent ; non lus comptés', () => {
  const l = conv.listConversations()

  assert.equal(l[0].slug, 'asistente')
  assert.equal(l[0].officeHidden, true)
  const lucia = l.find((c) => c.slug === 'lucia')!
  assert.equal(lucia.unread, 1)
  assert.equal(lucia.previewFrom, 'agent')
  const r = l.find((c) => c.slug === 'carla')!
  assert.equal(r.question, true)
  assert.equal(r.previewFrom, 'question')
})

test('ouvrir = lu ; non lu manuel', () => {
  conv.markConversationRead('demo', 'carla')
  conv.markConversationRead('demo', 'lucia')
  let l = conv.listConversations()
  assert.equal(l.find((c) => c.slug === 'carla')!.unread, 0)
  assert.equal(l.find((c) => c.slug === 'lucia')!.unread, 0)
  conv.setConversationUnread('demo', 'lucia', true)
  l = conv.listConversations()
  assert.equal(l.find((c) => c.slug === 'lucia')!.manualUnread, true)
})

test('fil : messages + question dans l\'ordre, titre retiré du texte', () => {
  const t = conv.getThread('demo', 'carla')
  assert.equal(t.length, 1)
  assert.equal(t[0].kind, 'question')
  assert.equal(t[0].title, 'Je publie ?')
  assert.equal(t[0].text, 'A ou B')
})
