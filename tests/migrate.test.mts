import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-mig-'))
process.env.BUREAU_ROOT = root
fs.writeFileSync(path.join(root, 'package.json'), '{}')
fs.writeFileSync(path.join(root, 'office.json'), JSON.stringify({ companyName: 'Demo', owner: 'Ana' }))
fs.mkdirSync(path.join(root, 'agents', 'ceo', 'memory'), { recursive: true })
fs.writeFileSync(path.join(root, 'agents', 'ceo', 'agent.json'), JSON.stringify({ slug: 'ceo', name: 'Directora', folders: ['$ROOT/agents', '/Users/m/x'], routines: [], desk: { col: 0, row: 0 } }))
fs.writeFileSync(path.join(root, 'agents', 'ceo', 'memory', 'MEMORY.md'), '# souvenirs')
fs.mkdirSync(path.join(root, 'meetings'), { recursive: true })

const store = await import('../src/main/store')

test('migration agents/ → offices/demo/ sans perte', () => {
  store.migrate()
  assert.ok(fs.existsSync(path.join(root, 'offices', 'demo', 'agents', 'ceo', 'memory', 'MEMORY.md')))
  assert.ok(!fs.existsSync(path.join(root, 'agents')))
  const offices = store.listOffices()
  assert.equal(offices.length, 1); assert.equal(offices[0].name, 'Demo')
  const ceo = store.loadAgent('demo', 'ceo')!
  assert.deepEqual(ceo.folders, ['$OFFICE/agents', '/Users/m/x'])
  store.migrate() // idempotent
  assert.equal(store.listOffices().length, 1)
})

test('création d\'un second bureau isolé', () => {
  const m = store.createOffice('Segunda Empresa', 'Ana', '#e0534f')
  assert.equal(m.slug, 'segunda-empresa')
  assert.equal(store.loadOffice('segunda-empresa').agents.length, 0)
  assert.equal(store.loadOffice('demo').agents.length, 1)
})
