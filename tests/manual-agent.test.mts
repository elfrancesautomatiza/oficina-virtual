import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'fs'; import os from 'os'; import path from 'path'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-')); process.env.BUREAU_ROOT = root
fs.writeFileSync(path.join(root,'package.json'),'{}')
const store = await import('../src/main/store.ts')
test('agent.json mínimo creado a mano', () => {
  const m = store.createOffice('Mi oficina','Yo','#000')
  const d = path.join(root,'offices',m.slug,'agents','ventas'); fs.mkdirSync(d,{recursive:true})
  fs.writeFileSync(path.join(d,'agent.json'), JSON.stringify({ name:'Valeria', role:'Ventas' }))
  const o = store.loadOffice(m.slug); const a = o.agents[0]
  assert.equal(a.slug,'ventas'); assert.ok(a.avatar); assert.ok(a.desk); assert.deepEqual(a.routines,[]); assert.equal(a.permissionMode,'acceptEdits')
})
