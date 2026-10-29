import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseEvent, buildArgs, runOnce } from '../src/main/claude-runner'

test('parseEvent : init, texte, outil, résultat', () => {
  assert.deepEqual(parseEvent('{"type":"system","subtype":"init","session_id":"abc"}'), [{ kind: 'init', sessionId: 'abc' }])
  const ev = parseEvent(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Bonjour' }, { type: 'tool_use', name: 'Read', input: { file_path: 'x' } }] } }))
  assert.equal(ev.length, 2)
  assert.deepEqual(ev[0], { kind: 'text', text: 'Bonjour' })
  assert.equal(ev[1].kind, 'tool')
  const r = parseEvent(JSON.stringify({ type: 'result', subtype: 'success', result: 'fini', session_id: 's1', total_cost_usd: 0.01, duration_ms: 1200 }))[0]
  assert.equal(r.kind, 'result')
  if (r.kind === 'result') { assert.equal(r.isError, false); assert.equal(r.sessionId, 's1') }
  assert.deepEqual(parseEvent('pas du json'), [])
  assert.deepEqual(parseEvent(''), [])
})

test('buildArgs : resume vs nouvelle session, outils, dossiers', () => {
  const a = buildArgs({ cwd: '.', prompt: 'x', sessionId: 'S', addDirs: ['/a', '/b'], allowedTools: ['Read', 'Bash(git *)'], permissionMode: 'dontAsk' })
  assert.ok(a.includes('--resume') && a[a.indexOf('--resume') + 1] === 'S')
  assert.ok(!a.includes('--session-id'))
  assert.deepEqual(a.slice(a.indexOf('--add-dir') + 1, a.indexOf('--add-dir') + 3), ['/a', '/b'])
  assert.equal(a[a.indexOf('--allowedTools') + 1], 'Read,Bash(git *)')
  const b = buildArgs({ cwd: '.', prompt: 'x', newSessionId: 'N' })
  assert.equal(b[b.indexOf('--session-id') + 1], 'N')
  assert.ok(b.includes('--output-format') && b.includes('stream-json') && b.includes('--verbose'))
})

test('runOnce : bout en bout avec un faux binaire claude', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-'))
  const fake = path.join(dir, 'claude')
  fs.writeFileSync(fake, `#!/usr/bin/env bash
prompt=$(cat)
echo '{"type":"system","subtype":"init","session_id":"sess-1"}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Reçu : '"$prompt"'"}]}}'
echo '{"type":"result","subtype":"success","result":"Reçu","session_id":"sess-1","total_cost_usd":0.002,"duration_ms":10}'
`)
  fs.chmodSync(fake, 0o755)
  process.env.CLAUDE_BIN = fake
  const res = await runOnce({ cwd: dir, prompt: 'salut' })
  assert.equal(res.isError, false)
  assert.equal(res.sessionId, 'sess-1')
  assert.equal(res.text, 'Reçu : salut')
  assert.equal(res.costUsd, 0.002)
})

test('runOnce : erreur du binaire remontée proprement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-'))
  const fake = path.join(dir, 'claude')
  fs.writeFileSync(fake, `#!/usr/bin/env bash\necho "Not logged in" >&2\nexit 1\n`)
  fs.chmodSync(fake, 0o755)
  process.env.CLAUDE_BIN = fake
  const res = await runOnce({ cwd: dir, prompt: 'x' })
  assert.equal(res.isError, true)
  assert.match(res.errorText ?? '', /Not logged in/)
})
