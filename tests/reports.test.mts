import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-root-'))
process.env.BUREAU_ROOT = root
fs.mkdirSync(path.join(root, 'offices', 'demo', 'agents', 'seo', 'reports'), { recursive: true })
fs.writeFileSync(path.join(root, 'package.json'), '{}')

const reports = await import('../src/main/reports')
const dir = path.join(root, 'offices', 'demo', 'agents', 'seo', 'reports')

test('condensation : 1er rapport sans historique', () => {
  const c = reports.condensationInstruction('demo', 'seo', '2026-10-01-r.md')
  assert.deepEqual(c.files, [])
  assert.match(c.text, /Escribe tu informe del día/)
})

test('condensation : rapports non lus fusionnés, un seul non lu reste', () => {
  fs.writeFileSync(path.join(dir, '2026-10-01-r.md'), '# Jour 1\nA')
  reports.registerReport('demo', 'seo', '2026-10-01-r.md')
  fs.writeFileSync(path.join(dir, '2026-10-02-r.md'), '# Jour 2\nB')
  reports.registerReport('demo', 'seo', '2026-10-02-r.md')
  assert.equal(reports.listReports('demo').filter((r) => !r.read).length, 2)

  const c = reports.condensationInstruction('demo', 'seo', '2026-10-03-r.md')
  assert.deepEqual(c.files, ['2026-10-01-r.md', '2026-10-02-r.md'])
  assert.match(c.text, /NO leyó tus 2 informe/)
  assert.match(c.text, /Jour 1/)

  fs.writeFileSync(path.join(dir, '2026-10-03-r.md'), '# Condensé\nA+B+C')
  reports.registerReport('demo', 'seo', '2026-10-03-r.md', c.files)
  const list = reports.listReports('demo')
  assert.equal(list.length, 1)
  assert.equal(list[0].file, '2026-10-03-r.md')
  assert.equal(list[0].condensedFrom, 2)
  assert.equal(list[0].read, false)
  assert.ok(fs.existsSync(path.join(dir, 'archive', '2026-10-01-r.md')))

  reports.markRead('demo', 'seo', '2026-10-03-r.md')
  assert.equal(reports.listReports('demo')[0].read, true)
  const c2 = reports.condensationInstruction('demo', 'seo', '2026-10-04-r.md')
  assert.deepEqual(c2.files, [], 'un rapport lu ne doit pas être condensé')
})
