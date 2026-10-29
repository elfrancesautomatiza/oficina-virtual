// Coffre d'accès d'un agent : clés API et identifiants.
// - agents/<slug>/access.json : la LISTE (noms, type, lien, email, statut). Jamais de secret dedans.
//   L'agent peut y ajouter une ligne « à remplir » ; ton patron colle la clé depuis l'app.
// - Les secrets (clé API, mot de passe) sont dans le Trousseau macOS (service « oficina-virtual »).
// - Au lancement d'un agent, les accès prêts deviennent des variables d'environnement.
import fs from 'fs'
import path from 'path'
import { execFile, spawn } from 'child_process'
import type { AccessEntry, AgentConfig } from '../shared/types'
import { agentDir, readJson, writeJson } from './store'

const SERVICE = 'oficina-virtual'
const isMac = process.platform === 'darwin'
const file = (o: string, slug: string): string => path.join(agentDir(o, slug), 'access.json')
const account = (o: string, slug: string, id: string): string => `${o}:${slug}:${id}`.replace(/[^a-zA-Z0-9:_-]/g, '_')

export const envName = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1').slice(0, 40) || 'ACCESO'
const slugId = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'acceso'
const hex = (s: string): string => Buffer.from(s, 'utf8').toString('hex')
const unhex = (h: string): string => Buffer.from(h.trim(), 'hex').toString('utf8')

// ---------- Trousseau (repli fichier hors macOS, pour les tests) ----------
function devVault(): string { return path.join(process.env.BV_DEV_VAULT ?? path.join(process.env.HOME ?? '.', '.oficina-virtual-dev-vault.json')) }

function keyGet(acct: string): Promise<string | null> {
  if (!isMac) { const v = readJson<Record<string, string>>(devVault(), {}); return Promise.resolve(v[acct] ? unhex(v[acct]) : null) }
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', acct, '-w'], { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(null)
      try { resolve(unhex(stdout.toString())) } catch { resolve(null) }
    })
  })
}

/** Écrit via `security -i` (stdin) : le secret n'apparaît jamais dans la liste des processus. */
function keySet(acct: string, value: string): Promise<void> {
  if (!isMac) { const v = readJson<Record<string, string>>(devVault(), {}); v[acct] = hex(value); writeJson(devVault(), v); return Promise.resolve() }
  return new Promise((resolve, reject) => {
    const p = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 && !/error/i.test(err) ? resolve() : reject(new Error(`Llavero: ${err.trim() || `código ${code}`}`))))
    p.stdin.write(`add-generic-password -U -s ${SERVICE} -a ${acct} -l ${SERVICE} -w ${hex(value)}\n`)
    p.stdin.end()
  })
}

function keyDel(acct: string): Promise<void> {
  if (!isMac) { const v = readJson<Record<string, string>>(devVault(), {}); delete v[acct]; writeJson(devVault(), v); return Promise.resolve() }
  return new Promise((resolve) => { execFile('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', acct], () => resolve()) })
}

// ---------- Liste ----------
const KINDS = ['api', 'login'] as const

/** Nettoie ce que l'agent a pu écrire : champs connus seulement, aucun secret. */
export function sanitize(list: unknown): AccessEntry[] {
  if (!Array.isArray(list)) return []
  const out: AccessEntry[] = []
  const seen = new Set<string>()
  for (const x of list) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 60) : ''
    if (!name) continue
    let id = typeof r.id === 'string' && r.id.trim() ? slugId(r.id) : slugId(name)
    while (seen.has(id)) id += '-2'
    seen.add(id)
    const kind = KINDS.includes(r.kind as never) ? (r.kind as AccessEntry['kind']) : 'api'
    const str = (k: string, n = 300): string | undefined => (typeof r[k] === 'string' && (r[k] as string).trim() ? (r[k] as string).trim().slice(0, n) : undefined)
    out.push({
      id, name, kind,
      env: envName(str('env', 40) ?? name),
      url: str('url'), user: kind === 'login' ? str('user', 120) : undefined,
      note: str('note', 500),
      requestedBy: r.requestedBy === 'agent' ? 'agent' : 'owner',
      updatedAt: str('updatedAt', 40)
    })
  }
  return out
}

function readList(o: string, slug: string): AccessEntry[] {
  const raw = readJson<unknown>(file(o, slug), [])
  const clean = sanitize(raw)
  // Si l'agent a glissé un champ non prévu (un mot de passe en clair par exemple), on réécrit le fichier propre.
  if (fs.existsSync(file(o, slug)) && JSON.stringify(raw) !== JSON.stringify(clean)) writeJson(file(o, slug), clean)
  return clean
}

export async function listAccess(o: string, slug: string): Promise<Array<AccessEntry & { ready: boolean }>> {
  const list = readList(o, slug)
  return Promise.all(list.map(async (e) => ({ ...e, ready: (await keyGet(account(o, slug, e.id))) !== null })))
}

export async function saveAccess(o: string, slug: string, entry: Partial<AccessEntry> & { name: string }, secret?: string): Promise<void> {
  const list = readList(o, slug)
  const [clean] = sanitize([{ ...entry, requestedBy: entry.requestedBy ?? 'owner' }])
  if (!clean) throw new Error('Falta el nombre')
  const i = entry.id ? list.findIndex((x) => x.id === entry.id) : -1
  if (i < 0 && list.some((x) => x.id === clean.id)) clean.id = `${clean.id}-${Date.now().toString(36).slice(-4)}`
  if (i < 0 && list.some((x) => x.env === clean.env)) clean.env = `${clean.env}_${list.length + 1}`
  clean.updatedAt = new Date().toISOString()
  if (i >= 0) list[i] = { ...clean, id: list[i].id }
  else list.push(clean)
  if (secret && secret.trim()) await keySet(account(o, slug, i >= 0 ? list[i].id : clean.id), secret.trim())
  writeJson(file(o, slug), list)
}

export async function removeAccess(o: string, slug: string, id: string): Promise<void> {
  await keyDel(account(o, slug, id))
  writeJson(file(o, slug), readList(o, slug).filter((x) => x.id !== id))
}

/** Variables d'environnement données à l'agent pour ses accès prêts. */
export async function accessEnv(o: string, slug: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  for (const e of readList(o, slug)) {
    const v = await keyGet(account(o, slug, e.id))
    if (v === null) continue
    if (e.kind === 'api') env[e.env] = v
    else { env[`${e.env}_PASSWORD`] = v; if (e.user) env[`${e.env}_USER`] = e.user; if (e.url) env[`${e.env}_URL`] = e.url }
  }
  return env
}

/** État des accès, pour le prompt de l'agent. */
export async function accessSummary(o: string, a: AgentConfig): Promise<string> {
  const list = await listAccess(o, a.slug)
  const lines = list.map((e) => e.kind === 'api'
    ? `- ${e.name} (clave API): ${e.ready ? `lista, variable $${e.env}` : 'POR COMPLETAR por tu jefe'}`
    : `- ${e.name} (usuario y contraseña${e.url ? `, ${e.url}` : ''}): ${e.ready ? `listo, variables $${e.env}_URL $${e.env}_USER $${e.env}_PASSWORD` : 'POR COMPLETAR por tu jefe'}`)
  return `${ACCESS_PROTOCOL}\nTus accesos actuales:\n${lines.length ? lines.join('\n') : '- ninguno'}`
}

export const ACCESS_PROTOCOL = `Accesos (claves API, usuarios y contraseñas): tu jefe los guarda en la pestaña «Accesos» de la app; los recibes como variables de entorno, que puedes usar en tus comandos Bash ("$NOMBRE_DE_LA_VARIABLE").
Reglas absolutas: NUNCA muestres, copies, repitas ni escribas el valor de una clave o de una contraseña (nada de echo, env, printenv, ni en un archivo, un informe o tu respuesta). Nunca le pidas a tu jefe que te pegue un secreto en la conversación. Nunca escribas una contraseña en Chrome: para un usuario y contraseña, usa un script (ej. Playwright en Python que lee las variables) o pídele a tu jefe que haga clic en «Iniciar sesión» en la pestaña Accesos, y luego trabaja en su sesión de Chrome.
Si te falta un acceso: agrega una línea en access.json (en tu carpeta), sin ningún secreto: {"name":"DataForSEO","kind":"api" o "login","url":"https://… (link de inicio de sesión o de la página donde se encuentra la clave)","note":"para qué sirve y dónde encontrar la clave","requestedBy":"agent"} — conserva las líneas existentes, JSON válido — y luego dile a tu jefe: «Creé la línea <nombre> en la pestaña Accesos, pega la clave ahí.»`

/** Interdits pour éviter d'afficher les variables d'environnement par erreur. */
export const ACCESS_DENY = ['Bash(env)', 'Bash(printenv:*)', 'Bash(printenv)', 'Bash(set)', 'Bash(export -p)']
