import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bv paths-'))  // espace dans le chemin, comme « bureau virtuel »
process.env.BUREAU_ROOT = root
const ag = path.join(root, 'offices', 'demo', 'agents', 'ventas')
fs.mkdirSync(path.join(ag, 'secrets'), { recursive: true })
fs.mkdirSync(path.join(ag, 'workspace', 'cola', 'pendientes'), { recursive: true })
fs.writeFileSync(path.join(ag, 'secrets', 'servicio.json'), '{}')
fs.writeFileSync(path.join(root, 'package.json'), '{}')

const { extractCandidates, resolveExisting } = await import('../src/main/paths')

test('chemin absolu avec espace, dans un bloc de code', () => {
  const msg = `J'ai créé le fichier, il ne te reste qu'à remplacer les trois valeurs :\n\`\`\`\n${path.join(ag, 'secrets', 'servicio.json')}\n\`\`\``
  const f = resolveExisting('demo', 'ventas', extractCandidates(msg))
  assert.equal(f.length, 1); assert.equal(f[0].name, 'servicio.json'); assert.equal(f[0].editable, true)
})

test('chemins relatifs au dossier de l’agent, inline et en texte', () => {
  const msg = 'Pour annuler, supprime son fichier dans `workspace/cola/pendientes/`. Les clés sont dans secrets/servicio.json.'
  const f = resolveExisting('demo', 'ventas', extractCandidates(msg))
  const names = f.map((x) => x.name).sort()
  assert.deepEqual(names, ['pendientes', 'servicio.json'])
  assert.equal(f.find((x) => x.name === 'pendientes')!.isDir, true)
})

test('rien d’inventé : chemins inexistants et URLs ignorés', () => {
  const msg = 'Voir https://example.com/consola et `tools/n-existe-pas.py`'
  assert.equal(resolveExisting('demo', 'ventas', extractCandidates(msg)).length, 0)
})

test('chemin absolu coupé par la ponctuation ou suivi de mots', () => {
  const msg = `Fichier : ${path.join(ag, 'secrets', 'servicio.json')}, à compléter.`
  const f = resolveExisting('demo', 'ventas', extractCandidates(msg))
  assert.equal(f.length, 1)
})
