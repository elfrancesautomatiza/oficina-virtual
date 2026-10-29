import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-rs-'))
process.env.BUREAU_ROOT = root
const ag = path.join(root, 'offices', 'tienda', 'agents', 'marta')
fs.mkdirSync(path.join(ag, 'routines'), { recursive: true })
fs.writeFileSync(path.join(root, 'package.json'), '{}')
fs.writeFileSync(path.join(root, 'offices', 'tienda', 'office.json'), JSON.stringify({ slug: 'tienda', name: 'Tienda', owner: 'M', color: '#000', createdAt: '1' }))
fs.writeFileSync(path.join(ag, 'agent.json'), JSON.stringify({ slug: 'marta', name: 'Marta Stock', role: 'x', routines: [{ id: 'old', label: 'Ancienne', time: '09:00', days: [], promptFile: 'old.md', enabled: false, writesReport: true }], folders: [], allowedTools: [], disallowedTools: [], desk: { col: 0, row: 0 } }))
fs.writeFileSync(path.join(ag, 'routines', 'old.md'), 'instructions sans en-tête')

const rs = await import('../src/main/routine-sync')
const store = await import('../src/main/store')

test('parseDays', () => {
  assert.deepEqual(rs.parseDays('lun-ven'), [1, 2, 3, 4, 5])
  assert.deepEqual(rs.parseDays('tous'), [])
  assert.deepEqual(rs.parseDays('lun,mer,ven'), [1, 3, 5])
  assert.deepEqual(rs.parseDays('week-end'), [0, 6])
  assert.deepEqual(rs.parseDays('ven-lun'), [0, 1, 5, 6])
  assert.deepEqual(rs.parseDays('[1, 2]'), [1, 2])
  assert.deepEqual(rs.parseDays('lun-vie'), [1, 2, 3, 4, 5])
  assert.deepEqual(rs.parseDays('todos'), [])
  assert.deepEqual(rs.parseDays('mié,vie'), [3, 5])
  assert.deepEqual(rs.parseDays('fin de semana'), [0, 6])
})

test('un agent crée une routine par fichier → elle apparaît dans agent.json + inbox', () => {
  fs.writeFileSync(path.join(ag, 'routines', 'stock-matin.md'), `---
label: Point stock du matin
time: "7h30"
tz: America/Santiago
days: lun-ven
report: oui
enabled: oui
---
1. Lis le fichier de stock.
2. Signale les ruptures.`)
  const res = rs.syncFromFiles('tienda', 'marta')
  assert.equal(res.added.length, 1)
  const a = store.loadAgent('tienda', 'marta')!
  const r = a.routines.find((x) => x.id === 'stock-matin')!
  assert.equal(r.label, 'Point stock du matin'); assert.equal(r.time, '07:30'); assert.equal(r.tz, 'America/Santiago')
  assert.deepEqual(r.days, [1, 2, 3, 4, 5]); assert.equal(r.enabled, true); assert.equal(r.source, 'agent')
  assert.equal(a.routines.find((x) => x.id === 'old')!.label, 'Ancienne', 'les routines sans en-tête ne bougent pas')
  assert.ok(fs.readdirSync(path.join(ag, 'inbox')).some((f) => f.includes('routine-stock-matin')))
  assert.equal(rs.syncFromFiles('tienda', 'marta').changed, false, 'idempotent')
})

test('modif dans les réglages → en-tête réécrit, instructions gardées ; prompt sans en-tête', () => {
  const a = store.loadAgent('tienda', 'marta')!
  a.routines.find((x) => x.id === 'stock-matin')!.time = '08:15'
  rs.syncToFiles('tienda', a)
  const txt = fs.readFileSync(path.join(ag, 'routines', 'stock-matin.md'), 'utf8')
  assert.match(txt, /time: "08:15"/)
  assert.match(txt, /Signale les ruptures/)
  assert.ok(!rs.routineBody(txt).includes('label:'))
  assert.equal(rs.syncFromFiles('tienda', 'marta').changed, false, 'pas de ping-pong')
  const old = fs.readFileSync(path.join(ag, 'routines', 'old.md'), 'utf8')
  assert.match(old, /^---/); assert.match(old, /instructions sans en-tête/)
})

test("l'agent désactive puis supprime sa routine", async () => {
  await new Promise((r) => setTimeout(r, 20))
  const f = path.join(ag, 'routines', 'stock-matin.md')
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('enabled: sí', 'enabled: no'))
  const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t)
  rs.syncFromFiles('tienda', 'marta')
  assert.equal(store.loadAgent('tienda', 'marta')!.routines.find((x) => x.id === 'stock-matin')!.enabled, false)
  fs.unlinkSync(f)
  rs.syncFromFiles('tienda', 'marta')
  assert.equal(store.loadAgent('tienda', 'marta')!.routines.some((x) => x.id === 'stock-matin'), false)
  assert.equal(store.loadAgent('tienda', 'marta')!.routines.some((x) => x.id === 'old'), true)
})

test('fichier sans en-tête : adopté désactivé, horaire deviné, question en inbox, README ignoré', () => {
  const d = path.join(ag, 'routines')
  fs.writeFileSync(path.join(d, 'README.md'), '# Routines\nexplications')
  fs.writeFileSync(path.join(d, 'stock-del-dia.md'), '# Revisión de stock del día (06:30, heure de Mexico)\n\n1. Lee la memoria.')
  rs.syncFromFiles('tienda', 'marta')
  const a = store.loadAgent('tienda', 'marta')!
  const r = a.routines.find((x) => x.id === 'stock-del-dia')!
  assert.equal(r.enabled, false); assert.equal(r.time, '06:30'); assert.equal(r.tz, 'America/Mexico_City')
  assert.equal(r.label, 'Revisión de stock del día')
  assert.ok(!a.routines.some((x) => x.id === 'README'))
  const txt = fs.readFileSync(path.join(d, 'stock-del-dia.md'), 'utf8')
  assert.match(txt, /^---\nlabel: Revisión de stock/); assert.match(txt, /1\. Lee la memoria/)
  assert.ok(fs.readdirSync(path.join(ag, 'inbox')).some((f) => f.includes('routine-stock-del-dia')))
  assert.match(rs.routinesSummary(a), /stock-del-dia\.md.*INACTIVA/)
})
