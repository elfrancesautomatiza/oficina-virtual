import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-root-'))
process.env.BUREAU_ROOT = root
const agent = path.join(root, 'offices', 'demo', 'agents', 'seo')
fs.mkdirSync(path.join(agent, 'inbox'), { recursive: true })
fs.mkdirSync(path.join(agent, 'reports'), { recursive: true })
fs.writeFileSync(path.join(root, 'package.json'), '{}')
fs.writeFileSync(path.join(root, 'offices', 'demo', 'office.json'), JSON.stringify({ slug: 'demo', name: 'Demo', owner: 'M', color: '#000', createdAt: '2026-01-01' }))
fs.writeFileSync(path.join(agent, 'agent.json'), JSON.stringify({ slug: 'seo', name: 'Pablo', role: 'SEO', routines: [], folders: [], allowedTools: [], disallowedTools: [], desk: { col: 0, row: 0 } }))

const inbox = await import('../src/main/inbox')

test('inbox : kind, titre, lecture, pastilles', () => {
  fs.writeFileSync(path.join(agent, 'inbox', '2026-10-04-0900-cles.md'), 'kind: question\n# Quel site je publie en premier ?\nDétail…')
  fs.writeFileSync(path.join(agent, 'inbox', '2026-10-04-0905-veille.md'), 'kind: info\n# Google a changé son algo\nDétail…')
  const items = inbox.listInbox('demo', 'seo')
  assert.equal(items.length, 2)
  assert.equal(items.find((i) => i.file.includes('cles'))?.kind, 'question')
  assert.equal(items.find((i) => i.file.includes('veille'))?.kind, 'info')
  let a = inbox.agentAlerts('demo', 'seo')
  assert.equal(a.inboxQuestions, 1); assert.equal(a.inboxInfos, 1); assert.equal(a.total, 2)
  inbox.markInboxRead('demo', 'seo', '2026-10-04-0900-cles.md')
  a = inbox.agentAlerts('demo', 'seo')
  assert.equal(a.inboxQuestions, 0); assert.equal(a.total, 1)
  assert.deepEqual(inbox.allAlerts(), { demo: 1 })
})

test('question en attente dans la conversation', () => {
  fs.writeFileSync(path.join(agent, 'sessions.json'), JSON.stringify({ sessionId: 'x', messages: [
    { id: '1', role: 'user', text: 'Salut', at: '2026-10-04T10:00:00Z' },
    { id: '2', role: 'assistant', text: 'Tu veux que je commence par le site A ou le site B ?', at: '2026-10-04T10:00:05Z' }
  ] }))
  assert.equal(inbox.pendingQuestion('demo', 'seo'), true)
  fs.writeFileSync(path.join(agent, 'sessions.json'), JSON.stringify({ sessionId: 'x', lastSeenAt: '2026-10-04T10:01:00Z', messages: [
    { id: '1', role: 'user', text: 'Salut', at: '2026-10-04T10:00:00Z' },
    { id: '2', role: 'assistant', text: 'Tu veux que je commence par le site A ou le site B ?', at: '2026-10-04T10:00:05Z' }
  ] }))
  assert.equal(inbox.pendingQuestion('demo', 'seo'), false, 'vue → plus de pastille')
})
