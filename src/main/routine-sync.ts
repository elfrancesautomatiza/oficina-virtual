// Routines décrites par fichier : un agent peut créer ou modifier ses routines en écrivant
// routines/<id>.md avec un en-tête. L'app synchronise ces en-têtes avec agent.json, dans les deux sens.
import fs from 'fs'
import path from 'path'
import type { AgentConfig, Routine } from '../shared/types'
import { agentDir, loadAgent, saveAgent, loadOffice, listOffices } from './store'

// Abréviations françaises (anciens fichiers) et espagnoles : aucune ne se chevauche (mar = mardi = martes).
const DAY_NAMES: Record<string, number> = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dom: 0, mie: 3, jue: 4, vie: 5, sab: 6 }
const DAY_LABELS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

export interface RoutineMeta { label?: string; time?: string; tz?: string; days?: number[]; monthDays?: number[]; report?: boolean; enabled?: boolean; maxTurns?: number }

/** Sépare l'en-tête (--- clé: valeur ---) des instructions. */
export function parseRoutineFile(content: string): { meta: RoutineMeta | null; body: string } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!m) return { meta: null, body: content }
  const meta: RoutineMeta = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.*?)\s*(#.*)?$/)
    if (!kv) continue
    const k = kv[1].toLowerCase()
    const v = kv[2].replace(/^["']|["']$/g, '').trim()
    if (k === 'label' || k === 'nom' || k === 'nombre') meta.label = v
    else if (k === 'time' || k === 'heure' || k === 'hora') { const t = v.match(/^(\d{1,2})[:h](\d{2})$/); if (t) meta.time = `${t[1].padStart(2, '0')}:${t[2]}` }
    else if (k === 'tz' || k === 'fuseau' || k === 'zona') meta.tz = v || undefined
    else if (k === 'days' || k === 'jours' || k === 'dias') meta.days = parseDays(v)
    else if (k === 'dates' || k === 'monthdays' || k === 'fechas') meta.monthDays = [...new Set(v.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= 31))].sort((a, b) => a - b)
    else if (k === 'report' || k === 'rapport' || k === 'informe') meta.report = truthy(v)
    else if (k === 'enabled' || k === 'active' || k === 'activa' || k === 'activo') meta.enabled = truthy(v)
    else if (k === 'tours' || k === 'maxturns' || k === 'turnos') { const n = parseInt(v, 10); if (n > 0) meta.maxTurns = Math.min(n, 300) }
  }
  return { meta, body: content.slice(m[0].length) }
}

const truthy = (v: string): boolean => /^(oui|yes|true|1|on|vrai|s[ií]|verdadero)$/i.test(v)

export function parseDays(v: string): number[] {
  const s = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[[\]\s]/g, '')
  if (!s || s === 'tous' || s === 'all' || s === 'quotidien' || s === 'todos' || s === 'todoslosdias' || s === 'diario') return []
  if (s === 'lun-ven' || s === 'semaine' || s === 'weekdays' || s === 'lun-vie' || s === 'entresemana' || s === 'laborables') return [1, 2, 3, 4, 5]
  if (s === 'week-end' || s === 'weekend' || s === 'sam-dim' || s === 'fin-de-semana' || s === 'findesemana' || s === 'finde' || s === 'sab-dom') return [0, 6]
  const out = new Set<number>()
  for (const part of s.split(',')) {
    const range = part.match(/^([a-z]{3})-([a-z]{3})$/)
    if (range && range[1] in DAY_NAMES && range[2] in DAY_NAMES) {
      let d = DAY_NAMES[range[1]]
      for (let i = 0; i < 7; i++) { out.add(d); if (d === DAY_NAMES[range[2]]) break; d = (d + 1) % 7 }
    } else if (/^\d$/.test(part) && +part <= 6) out.add(+part)
    else if (part.slice(0, 3) in DAY_NAMES) out.add(DAY_NAMES[part.slice(0, 3)])
  }
  const arr = [...out].sort()
  return arr.length === 7 ? [] : arr
}

export function formatDays(days: number[]): string {
  if (!days.length) return 'todos'
  if (days.join() === '1,2,3,4,5') return 'lun-vie'
  if (days.join() === '0,6') return 'fin-de-semana'
  return days.map((d) => DAY_LABELS[d]).join(',')
}

export function serializeRoutine(r: Routine, body: string): string {
  return `---
label: ${r.label}
time: "${r.time}"
tz: ${r.tz ?? ''}
days: ${formatDays(r.days)}
${r.monthDays?.length ? `dates: ${r.monthDays.join(',')}\n` : ''}report: ${r.writesReport ? 'sí' : 'no'}
enabled: ${r.enabled ? 'sí' : 'no'}
${r.maxTurns ? `turnos: ${r.maxTurns}\n` : ''}---
${body.replace(/^\n+/, '')}`
}

const routinesDir = (o: string, slug: string): string => path.join(agentDir(o, slug), 'routines')

/**
 * Fichiers → agent.json. Ajoute les routines créées par l'agent, applique les en-têtes modifiés,
 * retire les routines créées par l'agent dont le fichier a disparu. Renvoie les routines ajoutées.
 */
export function syncFromFiles(o: string, slug: string): { added: Routine[]; changed: boolean } {
  const a = loadAgent(o, slug)
  const dir = routinesDir(o, slug)
  if (!a || !fs.existsSync(dir)) return { added: [], changed: false }
  const added: Routine[] = []
  let changed = false
  const seen = new Set<string>()
  const orphans: Routine[] = []
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')) {
    const full = path.join(dir, file)
    const id = file.replace(/\.md$/, '')
    seen.add(file)
    const content = fs.readFileSync(full, 'utf8')
    const { meta } = parseRoutineFile(content)
    const existing = a.routines.find((r) => r.promptFile === file)
    if (!meta) {
      if (existing) continue // routine historique sans en-tête : gérée depuis les réglages
      // Fichier écrit sans en-tête : on l'adopte, désactivé, en devinant l'horaire depuis le titre.
      const guess = guessFromTitle(content)
      const r: Routine = { id, label: guess.label ?? id, time: guess.time ?? '08:00', tz: guess.tz, days: [], promptFile: file, enabled: false, writesReport: true, source: 'agent' }
      fs.writeFileSync(full, serializeRoutine(r, content))
      r.syncedAt = Math.floor(fs.statSync(full).mtimeMs)
      a.routines.push(r); orphans.push(r); changed = true
      continue
    }
    const mtime = Math.floor(fs.statSync(full).mtimeMs)
    if (existing) {
      if (mtime <= (existing.syncedAt ?? 0)) continue
      Object.assign(existing, applyMeta(existing, meta), { syncedAt: mtime })
      changed = true
    } else {
      const r: Routine = applyMeta({ id, label: id, time: '08:00', days: [], promptFile: file, enabled: true, writesReport: true, source: 'agent' }, meta)
      r.syncedAt = mtime
      a.routines.push(r); added.push(r); changed = true
    }
  }
  const before = a.routines.length
  a.routines = a.routines.filter((r) => r.source !== 'agent' || seen.has(r.promptFile))
  if (a.routines.length !== before) changed = true
  if (changed) saveAgent(o, a)
  for (const r of added) notifyNewRoutine(o, a, r)
  for (const r of orphans) notifyOrphan(o, a, r)
  return { added: [...added, ...orphans], changed }
}

const TZ_WORDS: Array<[RegExp, string]> = [
  [/chili|chile|santiago/i, 'America/Santiago'], [/colombie|colombia|bogot/i, 'America/Bogota'], [/mexique|mexico|méxico/i, 'America/Mexico_City'],
  [/paris|par[ií]s|france|francia|belgique|b[eé]lgica|bruxelles|bruselas/i, 'Europe/Paris'], [/espagne|espa[ñn]a|madrid/i, 'Europe/Madrid'], [/new york|nueva york/i, 'America/New_York']
]
/** "# Revisión de stock (06:30, hora de México)" → { label, time: '06:30', tz: 'America/Mexico_City' } */
export function guessFromTitle(content: string): { label?: string; time?: string; tz?: string } {
  const title = content.split('\n').find((l) => l.trim().startsWith('#'))?.replace(/^#+\s*/, '').trim()
  if (!title) return {}
  const t = title.match(/(\d{1,2})[:h](\d{2})/)
  const tz = TZ_WORDS.find(([re]) => re.test(title))?.[1]
  const label = title.replace(/\s*\([^)]*\)\s*$/, '').trim().slice(0, 80)
  return { label, time: t ? `${t[1].padStart(2, '0')}:${t[2]}` : undefined, tz }
}

function applyMeta(r: Routine, m: RoutineMeta): Routine {
  return {
    ...r,
    label: m.label ?? r.label,
    time: m.time ?? r.time,
    tz: m.tz !== undefined ? m.tz : r.tz,
    days: m.days ?? r.days,
    monthDays: m.monthDays,
    writesReport: m.report ?? r.writesReport,
    enabled: m.enabled ?? r.enabled,
    maxTurns: m.maxTurns ?? r.maxTurns
  }
}

/** agent.json → fichiers : après un changement fait dans les réglages, réécrit les en-têtes. */
export function syncToFiles(o: string, a: AgentConfig): AgentConfig {
  const dir = routinesDir(o, a.slug)
  fs.mkdirSync(dir, { recursive: true })
  for (const r of a.routines) {
    const full = path.join(dir, r.promptFile)
    const body = fs.existsSync(full) ? parseRoutineFile(fs.readFileSync(full, 'utf8')).body : ''
    const next = serializeRoutine(r, body)
    if (!fs.existsSync(full) || fs.readFileSync(full, 'utf8') !== next) fs.writeFileSync(full, next)
    r.syncedAt = Math.floor(fs.statSync(full).mtimeMs)
  }
  saveAgent(o, a)
  return a
}

/** Pour le runner : les instructions sans l'en-tête. */
export function routineBody(content: string): string {
  return parseRoutineFile(content).body
}

function notifyNewRoutine(o: string, a: AgentConfig, r: Routine): void {
  const inbox = path.join(agentDir(o, a.slug), 'inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  fs.writeFileSync(path.join(inbox, `${stamp}-routine-${r.id}.md`), `kind: info
# Nueva rutina: ${r.label}

${a.name} se creó una rutina.
- Horario: ${r.time}${r.tz ? ` (${r.tz})` : ' (hora del Mac)'}, días: ${formatDays(r.days)}
- Informe: ${r.writesReport ? 'sí' : 'no'}
- Estado: ${r.enabled ? 'activa' : 'inactiva'}

La encuentras en Ajustes → Rutinas, donde puedes modificarla, desactivarla o eliminarla.
`)
}

function notifyOrphan(o: string, a: AgentConfig, r: Routine): void {
  const inbox = path.join(agentDir(o, a.slug), 'inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  fs.writeFileSync(path.join(inbox, `${stamp}-routine-${r.id}.md`), `kind: question
# ¿Rutina por confirmar: ${r.label}?

${a.name} escribió esta rutina sin decir cuándo lanzarla. La agregué **desactivada** con el horario que pude adivinar: ${r.time}${r.tz ? ` (${r.tz})` : ' (hora del Mac)'}, todos los días.

Revisa el horario en Ajustes → Rutinas y marca «activa», o simplemente dile a ${a.name.split(' ')[0]} que la active.
`)
}

/** Ce que l'agent doit savoir de ses routines actuelles (injecté dans ses prompts). */
export function routinesSummary(a: AgentConfig): string {
  if (!a.routines.length) return 'Por ahora no tienes ninguna rutina configurada.'
  return 'Tus rutinas configuradas actualmente en Oficina Virtual:\n' + a.routines.map((r) =>
    `- routines/${r.promptFile} — «${r.label}», ${r.time}${r.tz ? ` ${r.tz}` : ' (hora del Mac)'}, ${formatDays(r.days)}, ${r.enabled ? 'ACTIVA' : 'INACTIVA'}`).join('\n')
}

const README = `# Rutinas

Cada archivo .md de esta carpeta es una rutina automática. Empieza con un encabezado y luego las instrucciones:

---
label: Nombre corto
time: "07:30"
tz: America/Santiago
days: lun-vie
report: sí
enabled: sí
---
Instrucciones detalladas de lo que hace el agente en cada ejecución.

tz: zona horaria IANA (vacío = hora del Mac). days: todos, lun-vie, fin-de-semana o lun,mie,vie. dates (opcional): días del mes, ej. 1 o 1,15 para una rutina mensual. report y enabled: sí o no.
La app lee estos encabezados cada 30 segundos y actualiza los ajustes. agent.json nunca se modifica a mano.
`
/** Dépose un README explicatif dans le dossier routines de chaque agent. */
export function ensureReadmes(): void {
  for (const office of listOffices()) for (const a of loadOffice(office.slug).agents) {
    const dir = routinesDir(office.slug, a.slug)
    try { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'README.md'); if (!fs.existsSync(f)) fs.writeFileSync(f, README) } catch { /* ignore */ }
  }
}

/** Passe sur tous les agents de tous les bureaux (appelé par le planificateur). */
export function syncAll(): Array<{ office: string; slug: string }> {
  const changed: Array<{ office: string; slug: string }> = []
  for (const office of listOffices()) {
    for (const a of loadOffice(office.slug).agents) {
      try { if (syncFromFiles(office.slug, a.slug).changed) changed.push({ office: office.slug, slug: a.slug }) } catch { /* fichier illisible : ignoré */ }
    }
  }
  return changed
}

/** Règles qui empêchent un agent de toucher à ses propres réglages. */
export const PROTECTED_RULES = ['Edit(agent.json)', 'Write(agent.json)', 'Edit(.mcp.json)', 'Write(.mcp.json)', 'Edit(sessions.json)', 'Write(sessions.json)']

export const ROUTINE_PROTOCOL = `Rutinas automáticas: si te piden crear, modificar o desactivar una de tus rutinas, hazlo mediante un archivo. Crear: escribe routines/<id-corto-sin-espacios>.md que empiece con este encabezado, seguido de las instrucciones detalladas de lo que harás en cada ejecución:
---
label: Nombre corto
time: "07:30"
tz: America/Santiago
days: lun-vie
report: sí
enabled: sí
---
(tz = zona horaria IANA, vacío para la hora del Mac; days = todos, lun-vie, fin-de-semana o lun,mie,vie; línea opcional dates: 1 (o 1,15) para que solo corra esos días del mes; report = escribir un informe en cada ejecución.) Modificar o activar: cambia el encabezado del archivo existente (un archivo sin encabezado nunca se lanza). Desactivar: enabled: no. agent.json está bloqueado: no intentes modificarlo ni pidas acceso, el encabezado basta. La app toma en cuenta el archivo en menos de 30 segundos; después confirma el nombre, el horario, la zona horaria y los días.`
