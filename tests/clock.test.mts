import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.BUREAU_ROOT = '/tmp'
const { localClock } = await import('../src/main/routines')

test('localClock : même instant, heures différentes selon le fuseau', () => {
  const t = new Date('2026-10-07T12:00:00Z') // mercredi
  assert.equal(localClock(t, 'Europe/Paris').hhmm, '14:00')
  assert.equal(localClock(t, 'America/Bogota').hhmm, '07:00')
  assert.equal(localClock(t, 'America/Santiago').hhmm, '09:00')
  assert.equal(localClock(t, 'Europe/Paris').day, 3)
  assert.equal(localClock(t, 'Europe/Paris').stamp, '2026-10-07')
})
test('localClock : passage de jour et minuit', () => {
  const t = new Date('2026-10-07T23:30:00Z')
  assert.equal(localClock(t, 'Asia/Tokyo').hhmm, '08:30')
  assert.equal(localClock(t, 'Asia/Tokyo').day, 4)
  assert.equal(localClock(t, 'Asia/Tokyo').stamp, '2026-10-08')
  const mid = new Date('2026-10-07T22:00:00Z')
  assert.equal(localClock(mid, 'Europe/Paris').hhmm, '00:00')
})
test('localClock : fuseau invalide → heure du Mac, sans planter', () => {
  const c = localClock(new Date(), 'Pas/Un_Fuseau')
  assert.match(c.hhmm, /^\d\d:\d\d$/)
})
