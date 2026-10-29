import { test } from 'node:test'
import assert from 'node:assert/strict'
const { merge3 } = await import('../src/main/merge')

test('connecteurs : un ajout fait ailleurs survit à une suppression faite dans les réglages', () => {
  const prev = { github: { url: 'g' }, canva: { url: 'c' } }          // ce que la fenêtre voyait
  const next = { github: { url: 'g' } }                               // tu retires canva
  const fresh = { github: { url: 'g' }, canva: { url: 'c' }, notion: { url: 'n' } } // Claude a ajouté notion
  assert.deepEqual(merge3(fresh, prev, next), { github: { url: 'g' }, notion: { url: 'n' } })
})
test('listes : coché/décoché sans perdre les ajouts externes', () => {
  assert.deepEqual(merge3(['Canva', 'Gmail'], ['Canva'], ['Canva', 'Notion']), ['Canva', 'Gmail', 'Notion'])
  assert.deepEqual(merge3(['Canva', 'Gmail'], ['Canva'], []), ['Gmail'])
})
test('routines : une routine créée par l’agent entre-temps est conservée', () => {
  const prev = [{ id: 'a', time: '07:00' }]
  const next = [{ id: 'a', time: '08:00' }]
  const fresh = [{ id: 'a', time: '07:00' }, { id: 'b', time: '06:00' }]
  assert.deepEqual(merge3(fresh, prev, next), [{ id: 'a', time: '08:00' }, { id: 'b', time: '06:00' }])
  assert.deepEqual(merge3(fresh, prev, []), [{ id: 'b', time: '06:00' }])
})
