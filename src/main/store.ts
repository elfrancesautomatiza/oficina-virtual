// Stockage sur disque. Un bureau = offices/<office>/ { office.json, agents/, meetings/ }.
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { AgentConfig, AgentSession, ChatMessage, OfficeMeta, OfficeState, NewAgentInput } from '../shared/types'
import { makeAvatar } from '../shared/avatar'

/** Racine des données = dossier qui contient package.json + offices/ (ou agents/ avant migration). */
export function projectRoot(): string {
  if (process.env.BUREAU_ROOT) return process.env.BUREAU_ROOT
  // Lancée depuis le dossier du projet (npm start / npm run dev) : les données vivent dans ce dossier.
  // On ne remonte JAMAIS dans les dossiers parents, pour ne pas ouvrir les données d'une autre app.
  if (!app.isPackaged) return app.getAppPath()
  // App empaquetée (Aplicaciones) : ~/oficina-virtual
  const home = path.join(app.getPath('home'), 'oficina-virtual')
  fs.mkdirSync(home, { recursive: true })
  return home
}

export const officesDir = (): string => path.join(projectRoot(), 'offices')
export const officeDir = (o: string): string => path.join(officesDir(), o)
export const officeFile = (o: string): string => path.join(officeDir(o), 'office.json')
export const agentsDir = (o: string): string => path.join(officeDir(o), 'agents')
export const agentDir = (o: string, slug: string): string => path.join(agentsDir(o), slug)
export const meetingsDir = (o: string): string => path.join(officeDir(o), 'meetings')

export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T } catch { return fallback }
}
export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'
}

/** Ancienne structure (agents/ à la racine) → offices/<slug>/. Idempotent. */
export function migrate(): void {
  const root = projectRoot()
  const oldAgents = path.join(root, 'agents')
  if (!fs.existsSync(oldAgents) || fs.existsSync(officesDir())) return
  const oldMeta = readJson<{ companyName?: string; owner?: string }>(path.join(root, 'office.json'), {})
  const name = oldMeta.companyName ?? 'Mi empresa'
  const slug = slugify(name)
  const dest = officeDir(slug)
  fs.mkdirSync(dest, { recursive: true })
  fs.renameSync(oldAgents, path.join(dest, 'agents'))
  const oldMeetings = path.join(root, 'meetings')
  if (fs.existsSync(oldMeetings)) fs.renameSync(oldMeetings, path.join(dest, 'meetings'))
  const oldArchive = path.join(root, 'agents-archive')
  if (fs.existsSync(oldArchive)) fs.renameSync(oldArchive, path.join(dest, 'agents-archive'))
  const meta: OfficeMeta = { slug, name, owner: oldMeta.owner ?? 'Yo', color: '#5b8cff', createdAt: new Date().toISOString() }
  writeJson(officeFile(slug), meta)
  // $ROOT/agents (accès de la DG) devient $OFFICE/agents
  for (const a of fs.readdirSync(path.join(dest, 'agents'))) {
    const f = path.join(dest, 'agents', a, 'agent.json')
    const cfg = readJson<AgentConfig | null>(f, null)
    if (cfg && cfg.folders.some((x) => x.startsWith('$ROOT/agents'))) {
      cfg.folders = cfg.folders.map((x) => x.replace(/^\$ROOT\/agents/, '$OFFICE/agents'))
      writeJson(f, cfg)
    }
  }
  const oldOffice = path.join(root, 'office.json')
  if (fs.existsSync(oldOffice)) fs.renameSync(oldOffice, path.join(dest, 'office.legacy.json'))
}

export function listOffices(): OfficeMeta[] {
  if (!fs.existsSync(officesDir())) return []
  return fs.readdirSync(officesDir())
    .map((s) => readJson<OfficeMeta | null>(officeFile(s), null))
    .filter((m): m is OfficeMeta => !!m)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
}

/** Range un bureau dans archives/offices/<slug>-<date> (rien n'est effacé). */
export function archiveOffice(o: string): void {
  const src = officeDir(o)
  if (!/^[a-z0-9-]+$/i.test(o) || !fs.existsSync(src)) throw new Error('Oficina no encontrada')
  const dest = path.join(projectRoot(), 'archives', 'offices', `${o}-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).slice(-4)}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.renameSync(src, dest)
}

export function createOffice(name: string, owner: string, color: string): OfficeMeta {
  let slug = slugify(name)
  let i = 2
  while (fs.existsSync(officeDir(slug))) slug = `${slugify(name)}-${i++}`
  fs.mkdirSync(agentsDir(slug), { recursive: true })
  fs.mkdirSync(meetingsDir(slug), { recursive: true })
  const meta: OfficeMeta = { slug, name, owner: owner || 'Yo', color, createdAt: new Date().toISOString() }
  writeJson(officeFile(slug), meta)
  return meta
}

export function loadOffice(o: string): OfficeState {
  const meta = readJson<OfficeMeta | null>(officeFile(o), null)
  const agents: AgentConfig[] = []
  if (fs.existsSync(agentsDir(o))) {
    for (const slug of fs.readdirSync(agentsDir(o)).sort()) {
      const a = readJson<AgentConfig | null>(path.join(agentDir(o, slug), 'agent.json'), null)
      if (a) agents.push(normalizeAgent(o, { ...a, slug }, agents))
    }
  }
  return { slug: o, companyName: meta?.name ?? o, owner: meta?.owner ?? 'Yo', color: meta?.color ?? '#5b8cff', agents }
}

export function loadAgent(o: string, slug: string): AgentConfig | null {
  const a = readJson<AgentConfig | null>(path.join(agentDir(o, slug), 'agent.json'), null)
  return a ? normalizeAgent(o, { ...a, slug }, []) : null
}

/** Agent créé à la main (ou par un assistant) avec un agent.json incomplet : on complète avec des valeurs sûres. */
export function normalizeAgent(o: string, a: AgentConfig, others: AgentConfig[]): AgentConfig {
  const name = typeof a.name === 'string' && a.name.trim() ? a.name : a.slug
  return {
    ...a,
    name,
    role: typeof a.role === 'string' ? a.role : 'Agente',
    tagline: typeof a.tagline === 'string' ? a.tagline : '',
    avatar: a.avatar && typeof a.avatar === 'object' ? a.avatar : makeAvatar(o + a.slug + name, a.slug.length % 2 ? 'f' : 'm'),
    desk: a.desk && Number.isFinite(a.desk.col) && Number.isFinite(a.desk.row) ? a.desk : nextFreeDesk(others),
    folders: Array.isArray(a.folders) ? a.folders : [],
    allowedTools: Array.isArray(a.allowedTools) ? a.allowedTools : ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
    disallowedTools: Array.isArray(a.disallowedTools) ? a.disallowedTools : [],
    permissionMode: a.permissionMode ?? 'acceptEdits',
    routinePermissionMode: a.routinePermissionMode ?? 'dontAsk',
    routines: Array.isArray(a.routines) ? a.routines : [],
    createdAt: a.createdAt ?? new Date().toISOString(),
    color: typeof a.color === 'string' ? a.color : PALETTE[others.length % PALETTE.length]
  }
}
export function saveAgent(o: string, a: AgentConfig): void {
  writeJson(path.join(agentDir(o, a.slug), 'agent.json'), a)
}

export function loadSession(o: string, slug: string): AgentSession {
  return readJson<AgentSession>(path.join(agentDir(o, slug), 'sessions.json'), { sessionId: null, messages: [] })
}
export function saveSession(o: string, slug: string, s: AgentSession): void {
  writeJson(path.join(agentDir(o, slug), 'sessions.json'), { ...s, messages: s.messages.slice(-400) })
}
export function appendMessage(o: string, slug: string, m: ChatMessage): AgentSession {
  const s = loadSession(o, slug)
  s.messages.push(m)
  saveSession(o, slug, s)
  return s
}
export function markSeen(o: string, slug: string): void {
  const s = loadSession(o, slug)
  s.lastSeenAt = new Date().toISOString()
  saveSession(o, slug, s)
}

export function readMemory(o: string, slug: string): string {
  const f = path.join(agentDir(o, slug), 'memory', 'MEMORY.md')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
export function readClaudeMd(o: string, slug: string): string {
  const f = path.join(agentDir(o, slug), 'CLAUDE.md')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
export function writeClaudeMd(o: string, slug: string, content: string): void {
  fs.writeFileSync(path.join(agentDir(o, slug), 'CLAUDE.md'), content)
}

/** $ROOT = racine des données, $OFFICE = dossier du bureau, ~ = home. */
export function resolveFolders(o: string, a: AgentConfig): string[] {
  const home = process.env.HOME ?? ''
  return a.folders
    .map((f) => f.replace(/^\$OFFICE/, officeDir(o)).replace(/^\$ROOT/, projectRoot()).replace(/^~/, home))
    .filter((f) => fs.existsSync(f))
}

function nextFreeDesk(agents: AgentConfig[]): { col: number; row: number } {
  const taken = new Set(agents.map((a) => `${a.desk.col},${a.desk.row}`))
  for (let row = 0; row < 6; row++) for (let col = 0; col < 4; col++) {
    if (!taken.has(`${col},${row}`)) return { col, row }
  }
  return { col: 0, row: agents.length }
}

const PALETTE = ['#1f6feb', '#e0534f', '#2a9d8f', '#6a4c93', '#f4a261', '#264653', '#ff7b9c', '#118ab2', '#06d6a0', '#b5179e']

export function createAgent(o: string, input: NewAgentInput): AgentConfig {
  const office = loadOffice(o)
  let slug = slugify(input.name)
  let i = 2
  while (fs.existsSync(agentDir(o, slug))) slug = `${slugify(input.name)}-${i++}`
  const dir = agentDir(o, slug)
  for (const d of ['memory', 'routines', 'reports', 'workspace', 'inbox']) fs.mkdirSync(path.join(dir, d), { recursive: true })

  const allowed = ['Read', 'Glob', 'Grep', 'Write', 'Edit']
  if (input.allowWeb) allowed.push('WebSearch', 'WebFetch')
  if (input.allowBash) allowed.push('Bash')

  const agent: AgentConfig = {
    slug, name: input.name, role: input.role, tagline: input.tagline,
    avatar: makeAvatar(o + slug + input.name, input.gender),
    desk: nextFreeDesk(office.agents),
    folders: input.folders.filter(Boolean),
    allowedTools: allowed, disallowedTools: [],
    permissionMode: 'acceptEdits', routinePermissionMode: 'dontAsk',
    routines: [], createdAt: new Date().toISOString(),
    color: PALETTE[office.agents.length % PALETTE.length]
  }
  saveAgent(o, agent)
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), defaultClaudeMd(agent, input.mission, office))
  fs.writeFileSync(path.join(dir, 'memory', 'MEMORY.md'), `# Memoria de ${agent.name}\n\n_Nada todavía. Aquí anoto lo que aprendo: decisiones, preferencias de ${office.owner}, resultados, errores que no repetir._\n`)
  return agent
}

export function deleteAgent(o: string, slug: string): void {
  const dir = agentDir(o, slug)
  const archive = path.join(officeDir(o), 'agents-archive')
  fs.mkdirSync(archive, { recursive: true })
  if (fs.existsSync(dir)) fs.renameSync(dir, path.join(archive, `${slug}-${Date.now()}`))
}

export function defaultClaudeMd(a: AgentConfig, mission: string, office: OfficeState): string {
  return `# ${a.name} · ${a.role}

Eres **${a.name}**, ${a.role.toLowerCase()} del equipo virtual de ${office.companyName}, la empresa de ${office.owner}.
${a.tagline}

## Misión
${mission.trim()}

## Cómo trabajas
- Trabajas para ${office.owner}. Eres directo, conciso, sin halagos. Das opiniones claras y las justificas.
- Respondes en el idioma en que te escriben.
- Antes de cualquier acción irreversible (publicar, enviar, borrar, pagar), pides confirmación.
- Nunca sales de tu perímetro: tus carpetas son las de \`agent.json\` (campo \`folders\`) y tu carpeta \`workspace/\`.

## Memoria (obligatoria)
- Tu memoria larga es \`memory/MEMORY.md\`. Léela al inicio de cada conversación.
- Al final de cada intercambio útil, actualízala: decisiones, preferencias de ${office.owner}, hechos aprendidos, errores que no repetir. Sé sintético (máx. ~300 líneas, condensa si hace falta).
- Las actas de las reuniones de equipo están en \`memory/meetings/\`. Tenlas en cuenta.

## Bandeja (inbox/)
Si tienes una pregunta que te bloquea o una información importante fuera de una conversación (rutina, reunión), escribe un archivo \`inbox/AAAA-MM-DD-HHMM-<tema>.md\` cuya primera línea sea \`kind: question\` o \`kind: info\`, luego un título \`# ...\` y el detalle. ${office.owner} verá una pastilla.

## Informes
- Cuando una rutina te pide un informe, escríbelo en \`reports/\` con el formato pedido. Corto, factual: lo hecho, los resultados medidos y lo que propones después.
`
}

/** Premier lancement : un bureau « Mi oficina » avec un agent d'exemple, pour voir tout de suite à quoi ça ressemble. */
export function ensureStarterOffice(): void {
  if (listOffices().length > 0) return
  const meta = createOffice('Mi oficina', 'Yo', '#5b8cff')
  createAgent(meta.slug, {
    name: 'Sofía', role: 'Asistente', gender: 'f',
    tagline: 'Tu primera agente: pregúntale lo que quieras y edita su CLAUDE.md para darle un trabajo.',
    mission: 'Ayudar a tu jefe con lo que te pida: ordenar ideas, redactar textos, investigar en la web y preparar listas de tareas. Cuando no sepas algo, lo dices. Propones siempre el siguiente paso concreto.',
    folders: [], allowWeb: true, allowBash: false
  } as NewAgentInput)
}

/** Écrit le .mcp.json de l'agent à partir de agent.json et renvoie ce qu'il faut passer au CLI. */
export const claudeAiToolPrefix = (name: string): string => `mcp__claude_ai_${name.trim().replace(/[^A-Za-z0-9_-]+/g, '_')}`

export function mcpFor(o: string, a: AgentConfig): { mcpConfig?: string; tools: string[]; strictMcp: boolean } {
  const servers = a.mcpServers ?? {}
  const file = path.join(agentDir(o, a.slug), '.mcp.json')
  const names = Object.keys(servers)
  const cloud = (a.claudeAiConnectors ?? []).filter(Boolean)
  // Connecteurs du compte claude.ai autorisés : on ne coupe pas les connecteurs du compte (pas de --strict-mcp-config).
  const strictMcp = cloud.length === 0
  const cloudTools = cloud.map(claudeAiToolPrefix)
  if (!names.length) { if (fs.existsSync(file)) fs.unlinkSync(file); return { tools: cloudTools, strictMcp } }
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2))
  return { mcpConfig: file, tools: [...names.map((n) => `mcp__${n}`), ...cloudTools], strictMcp }
}

/** Skills visibles par l'agent : les siens (.claude/skills) et ceux de ~/.claude/skills (communs). */
export function listSkills(o: string, slug: string): { own: string[]; global: string[]; dir: string } {
  const dir = path.join(agentDir(o, slug), '.claude', 'skills')
  fs.mkdirSync(dir, { recursive: true })
  const names = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d).filter((n) => fs.existsSync(path.join(d, n, 'SKILL.md'))).sort() : []
  const home = process.env.HOME ?? ''
  const global = [...names(path.join(home, '.claude', 'skills')), ...names(path.join(home, '.claude', 'skills', 'synced'))]
  return { own: names(dir), global: [...new Set(global)], dir }
}

export function readRoutine(o: string, slug: string, promptFile: string): string {
  const f = path.join(agentDir(o, slug), 'routines', path.basename(promptFile))
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
export function writeRoutine(o: string, slug: string, promptFile: string, content: string): void {
  const dir = path.join(agentDir(o, slug), 'routines')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, path.basename(promptFile)), content)
}
