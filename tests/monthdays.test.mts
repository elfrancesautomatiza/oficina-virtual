import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
process.env.BUREAU_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-md-'))
const { parseRoutineFile: parseFrontMatter } = await import('../src/main/routine-sync')
const { isDue } = await import('../src/main/routines')
test('dates: 1 → mensuelle', () => {
  const r = { id: 'm', label: 'm', time: '06:00', tz: 'UTC', days: [], monthDays: [1], promptFile: 'm.md', enabled: true, writesReport: false }
  assert.equal(isDue(r, new Date('2026-11-01T06:00:00Z')), true)
  assert.equal(isDue(r, new Date('2026-10-23T06:00:00Z')), false)
  if (parseFrontMatter) assert.deepEqual(parseFrontMatter('---\ndates: 15, 1\n---\nx').meta.monthDays, [1, 15])
})
