import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDue } from '../src/main/routines.ts'

const base = { id: 'x', label: 'x', time: '06:30', tz: 'UTC', days: [] as number[], promptFile: 'x.md', enabled: true, writesReport: false }
const at = (iso: string): Date => new Date(iso)

test('part à l\'heure', () => assert.equal(isDue(base, at('2026-10-14T06:30:10Z')), true))
test('pas avant l\'heure', () => assert.equal(isDue({ ...base, lastRun: '2026-10-13T06:30:00Z' }, at('2026-10-14T06:00:00Z')), false))
test('rattrapage si déjà tournée hier', () => assert.equal(isDue({ ...base, lastRun: '2026-10-13T06:31:00Z' }, at('2026-10-14T09:00:00Z')), true))
test('pas de rattrapage si déjà faite aujourd\'hui', () => assert.equal(isDue({ ...base, lastRun: '2026-10-14T06:31:00Z' }, at('2026-10-14T09:00:00Z')), false))
test('pas de rattrapage pour une routine jamais lancée', () => assert.equal(isDue(base, at('2026-10-14T09:00:00Z')), false))
test('pas de rattrapage au-delà de 12 h', () => assert.equal(isDue({ ...base, lastRun: '2026-10-13T06:31:00Z' }, at('2026-10-14T19:00:00Z')), false))
test('jour exclu', () => assert.equal(isDue({ ...base, days: [1], lastRun: '2026-10-13T06:31:00Z' }, at('2026-10-14T09:00:00Z')), false))
test('désactivée', () => assert.equal(isDue({ ...base, enabled: false }, at('2026-10-14T06:30:00Z')), false))
