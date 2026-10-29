// Boutons rapides d'un agent : agents/<slug>/actions.json.
// Chaque bouton ouvre des sous-boutons (étapes) et compose le message envoyé à l'agent.
// L'agent peut modifier ce fichier lui-même (ACTIONS_PROTOCOL dans son prompt).
import fs from 'fs'
import path from 'path'
import type { AgentConfig, QuickAction } from '../shared/types'
import { agentDir, readJson, writeJson } from './store'

const file = (o: string, slug: string): string => path.join(agentDir(o, slug), 'actions.json')

const GENERIC: QuickAction[] = [
  { id: 'punto', label: 'Hacer el punto', hint: 'Lo hecho, lo que bloquea', steps: [], template: 'Hazme el punto: lo que hiciste últimamente, lo que bloquea y lo que propones después. Corto.' },
  { id: 'ideas', label: '3 ideas', hint: 'Para avanzar', steps: [{ key: 'horizonte', label: 'Horizonte', options: ['Esta semana', 'Este mes'] }], template: 'Propónme 3 ideas concretas para {horizonte}, ordenadas por impacto, con el primer paso de cada una.' },
  { id: 'rutina', label: 'Lanzar mi rutina', hint: 'Ejecutarla ahora', steps: [], template: 'Ejecuta ahora tu rutina principal como si fuera la hora prevista y dame el resultado.' }
]

export function defaultActions(a: AgentConfig): QuickAction[] {
  void a
  return GENERIC
}

function valid(list: unknown): list is QuickAction[] {
  return Array.isArray(list) && list.every((q) => q && typeof q.id === 'string' && typeof q.label === 'string' && typeof q.template === 'string' && Array.isArray(q.steps))
}

export function getActions(o: string, a: AgentConfig): QuickAction[] {
  const f = file(o, a.slug)
  if (!fs.existsSync(f)) { const d = defaultActions(a); writeJson(f, d); return d }
  const list = readJson<unknown>(f, null)
  return valid(list) ? list : defaultActions(a)
}

export function saveActions(o: string, slug: string, list: QuickAction[]): void {
  if (!valid(list)) throw new Error('Formato de botones no válido')
  writeJson(file(o, slug), list)
}

export const ACTIONS_PROTOCOL = `Botones rápidos: tu jefe a menudo te habla mediante botones definidos en actions.json (en tu carpeta). Formato: [{"id":"...","label":"Texto del botón","hint":"subtítulo corto","steps":[{"key":"estilo","label":"Estilo","options":["A","B"],"free":"placeholder si hay texto libre"}],"template":"Mensaje con {estilo}"}]. Si te pide varias veces el mismo tipo de tarea, propónle convertirlo en un botón; si acepta, agrégalo en actions.json (conserva los botones existentes, JSON válido).`

/** Remplit le modèle avec les choix. */
export function fillTemplate(t: string, v: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')
}
