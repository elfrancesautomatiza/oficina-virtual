// Disposition 3D d'un bureau : taille de la salle, position des postes, décorations.
// Fichier offices/<office>/layout.json, écrit par l'app (mode Aménager).
import path from 'path'
import type { OfficeLayout } from '../shared/types'
import { officeDir, readJson, writeJson } from './store'

const file = (o: string): string => path.join(officeDir(o), 'layout.json')

export function getLayout(o: string): OfficeLayout | null {
  const l = readJson<OfficeLayout | null>(file(o), null)
  if (!l || typeof l.w !== 'number' || typeof l.d !== 'number') return null
  return { w: l.w, d: l.d, agents: l.agents ?? {}, decos: Array.isArray(l.decos) ? l.decos : null }
}

export function saveLayout(o: string, l: OfficeLayout): void {
  const clean: OfficeLayout = {
    w: Math.max(8, Math.min(40, Math.round(l.w))),
    d: Math.max(8, Math.min(30, Math.round(l.d))),
    agents: Object.fromEntries(Object.entries(l.agents ?? {}).map(([k, v]) => [k, { x: +v.x, z: +v.z, r: +(v.r ?? 0) }])),
    decos: (l.decos ?? []).map((d) => ({ t: String(d.t), x: +d.x, z: +d.z, r: +(d.r ?? 0) }))
  }
  writeJson(file(o), clean)
}
