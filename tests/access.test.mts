import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-root-'))
process.env.BUREAU_ROOT = root
process.env.BV_DEV_VAULT = path.join(root, 'vault.json')
const agent = path.join(root, 'offices', 'demo', 'agents', 'seo')
fs.mkdirSync(agent, { recursive: true })
fs.writeFileSync(path.join(root, 'package.json'), '{}')
fs.writeFileSync(path.join(root, 'offices', 'demo', 'office.json'), JSON.stringify({ slug: 'demo', name: 'Demo', owner: 'M', color: '#000', createdAt: '2026-01-01' }))
fs.writeFileSync(path.join(agent, 'agent.json'), JSON.stringify({ slug: 'seo', name: 'Pablo', role: 'SEO', routines: [], folders: [], allowedTools: [], disallowedTools: [], desk: { col: 0, row: 0 } }))

const acc = await import('../src/main/access')

test('ligne créée par l\'agent : à remplir, et aucun secret ne reste dans le fichier', async () => {
  fs.writeFileSync(path.join(agent, 'access.json'), JSON.stringify([{ name: 'DataForSEO', kind: 'api', url: 'https://app.dataforseo.com', note: 'para el informe SEO', requestedBy: 'agent', value: 'SECRET123' }]))
  const l = await acc.listAccess('demo', 'seo')
  assert.equal(l.length, 1); assert.equal(l[0].ready, false); assert.equal(l[0].env, 'DATAFORSEO'); assert.equal(l[0].requestedBy, 'agent')
  assert.ok(!fs.readFileSync(path.join(agent, 'access.json'), 'utf8').includes('SECRET123'))
  const s = await acc.accessSummary('demo', { slug: 'seo' } as never)
  assert.match(s, /DataForSEO \(clave API\): POR COMPLETAR/)
})

test('Ana remplit : prête, variable donnée à l\'agent, jamais dans access.json', async () => {
  await acc.saveAccess('demo', 'seo', { id: 'dataforseo', name: 'DataForSEO', kind: 'api' }, 'clé-ultra-secrète')
  const l = await acc.listAccess('demo', 'seo')
  assert.equal(l[0].ready, true); assert.equal(l[0].requestedBy, 'owner')
  assert.deepEqual(await acc.accessEnv('demo', 'seo'), { DATAFORSEO: 'clé-ultra-secrète' })
  assert.ok(!fs.readFileSync(path.join(agent, 'access.json'), 'utf8').includes('ultra'))
})

test('identifiant : URL, email, mot de passe en variables', async () => {
  await acc.saveAccess('demo', 'seo', { name: 'Back-office Demo', kind: 'login', url: 'https://bo.example.com/login', user: 'm@example.com' }, 'p@ss é')
  const env = await acc.accessEnv('demo', 'seo')
  assert.equal(env.BACK_OFFICE_DEMO_PASSWORD, 'p@ss é'); assert.equal(env.BACK_OFFICE_DEMO_USER, 'm@example.com'); assert.equal(env.BACK_OFFICE_DEMO_URL, 'https://bo.example.com/login')
})

test('retirer efface la ligne et le secret', async () => {
  await acc.removeAccess('demo', 'seo', 'dataforseo')
  const env = await acc.accessEnv('demo', 'seo')
  assert.equal(env.DATAFORSEO, undefined)
  assert.equal((await acc.listAccess('demo', 'seo')).length, 1)
})
