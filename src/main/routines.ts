// Exécution et planification des routines quotidiennes.
// Une routine = un fichier prompt dans agents/<slug>/routines/, lancée dans une session
// éphémère (pas la conversation de l'agent) mais avec son CLAUDE.md et sa mémoire.
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import type { AgentConfig, Routine } from '../shared/types'
import { ClaudeRun, type RunResult } from './claude-runner'
import { agentDir, loadAgent, loadOffice, saveAgent, resolveFolders, listOffices, mcpFor } from './store'
import { condensationInstruction, registerReport, todayReportName } from './reports'
import { routineBody, syncAll, PROTECTED_RULES, ROUTINE_PROTOCOL, routinesSummary } from './routine-sync'
import { accessEnv, accessSummary, ACCESS_DENY } from './access'

export const routineEvents = new EventEmitter()
const running = new Set<string>()
const routineRuns = new Map<string, ClaudeRun>()
const stopped = new Set<string>()

/** Erreurs d'accès à l'API dues au réseau du Mac (pas à la routine elle-même). */
export const isNetworkError = (t: string): boolean => /Unable to connect to API|Can't reach the API|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|certificate|socket hang up|network/i.test(t)

/** Bouton Stop : arrête les routines en cours de cet agent. Renvoie true s'il y en avait. */
export function stopRoutines(o: string, slug: string): boolean {
  let any = false
  for (const [k, run] of routineRuns) if (k.startsWith(`${o}/${slug}:`)) { stopped.add(k); run.stop('Rutina detenida a tu pedido.'); any = true }
  return any
}
/** Routines en cours. */
export const runningRoutines = (): Array<{ office: string; slug: string; routineId: string }> =>
  [...running].map((k) => { const [o, rest] = k.split('/'); const [slug, routineId] = rest.split(':'); return { office: o, slug, routineId } })

export function routineSystemPrompt(a: AgentConfig): string {
  return `Te está ejecutando una rutina automática, nadie lee en directo. No hagas ninguna pregunta en tu respuesta: toma decisiones prudentes. Si una pregunta de verdad te bloquea o si una información importante debe llegar a tu jefe, escribe un archivo inbox/AAAA-MM-DD-HHMM-<tema>.md (primera línea \`kind: question\` o \`kind: info\`, luego un título # y el detalle). Escribe en español (informes, inbox, memoria) salvo que tu jefe te escriba en otro idioma. Actualiza memory/MEMORY.md al final. ${ROUTINE_PROTOCOL} ${routinesSummary(a)} Fecha de hoy: ${new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`
}

export async function runRoutine(o: string, slug: string, routineId: string): Promise<void> {
  const key = `${o}/${slug}:${routineId}`
  if (running.has(key)) return
  const agent = loadAgent(o, slug)
  const routine = agent?.routines.find((r) => r.id === routineId)
  if (!agent || !routine) throw new Error(`Rutina no encontrada: ${key}`)
  const promptFile = path.join(agentDir(o, slug), 'routines', routine.promptFile)
  if (!fs.existsSync(promptFile)) throw new Error(`Falta el prompt: ${promptFile}`)

  running.add(key)
  setStatus(o, agent, routine, 'running')
  routineEvents.emit('routine', { office: o, slug, routineId, status: 'running' })

  let prompt = routineBody(fs.readFileSync(promptFile, 'utf8'))
  let condensed: string[] = []
  let reportFile = ''
  if (routine.writesReport) {
    reportFile = todayReportName(routine.id)
    const c = condensationInstruction(o, slug, reportFile)
    condensed = c.files
    prompt += `\n\n## Informe\n${c.text}`
  }

  const logDir = path.join(agentDir(o, slug), 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const log = path.join(logDir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${routine.id}.md`)

  try {
    const [env, access] = await Promise.all([accessEnv(o, slug), accessSummary(o, agent)])
    const attempt = (): Promise<RunResult> => { const run = new ClaudeRun({
      env,
      cwd: agentDir(o, slug),
      prompt,
      noPersist: true,
      addDirs: resolveFolders(o, agent),
      allowedTools: [...agent.allowedTools, ...mcpFor(o, agent).tools, ...(agent.chrome ? ['mcp__claude-in-chrome'] : [])],
      mcpConfig: mcpFor(o, agent).mcpConfig,
      strictMcp: mcpFor(o, agent).strictMcp,
      chrome: agent.chrome === true,
      disallowedTools: [...agent.disallowedTools, ...PROTECTED_RULES, ...ACCESS_DENY],
      permissionMode: agent.routinePermissionMode,
      appendSystemPrompt: routineSystemPrompt(agent) + `\n\n${access}`,
      model: agent.model,
      maxTurns: routine.maxTurns ?? 60,
      idleTimeoutMs: 20 * 60 * 1000
    })
    routineRuns.set(key, run)
    return new Promise<RunResult>((resolve) => { run.emitter.on('done', resolve); run.start() }) }
    // Coupure réseau (Wi-Fi, portail captif, DNS) : on réessaie plus tard au lieu de perdre la routine du jour.
    let res = await attempt()
    const notes: string[] = []
    for (const wait of [5, 15, 30]) {
      if (!res.isError || !isNetworkError(res.errorText ?? res.text) || stopped.has(key)) break
      notes.push(`Red no disponible (${(res.errorText ?? '').slice(0, 120)}), nuevo intento en ${wait} min.`)
      for (let t = 0; t < wait * 6 && !stopped.has(key); t++) await new Promise((r) => setTimeout(r, 10_000))
      if (stopped.has(key)) break
      res = await attempt()
    }
    fs.writeFileSync(log, `# ${routine.label}\n\nEstado: ${res.isError ? 'error' : 'ok'} · costo: ${res.costUsd ?? '?'} $ · duración: ${Math.round((res.durationMs ?? 0) / 1000)} s\n\n${res.text}\n\n${res.errorText ?? ''}${notes.length ? `\n\n${notes.join('\n')}` : ''}`)
    if (routine.writesReport && fs.existsSync(path.join(agentDir(o, slug), 'reports', reportFile))) {
      registerReport(o, slug, reportFile, condensed)
    }
    setStatus(o, agent, routine, res.isError ? 'error' : 'ok')
    routineEvents.emit('routine', { office: o, slug, routineId, status: res.isError ? 'error' : 'ok' })
  } catch (e) {
    fs.writeFileSync(log, `# ${routine.label}\n\nError: ${(e as Error).message}`)
    setStatus(o, agent, routine, 'error')
    routineEvents.emit('routine', { office: o, slug, routineId, status: 'error' })
  } finally {
    running.delete(key)
    routineRuns.delete(key)
    stopped.delete(key)
  }
}

function setStatus(o: string, agent: AgentConfig, routine: Routine, status: Routine['lastStatus']): void {
  const fresh = loadAgent(o, agent.slug)
  if (!fresh) return
  const r = fresh.routines.find((x) => x.id === routine.id)
  if (!r) return
  r.lastStatus = status
  if (status !== 'running') r.lastRun = new Date().toISOString()
  saveAgent(o, fresh)
}

/** Heure, jour (0 = dimanche) et date du jour dans un fuseau donné (fuseau du Mac si vide ou invalide). */
export function localClock(now: Date, tz?: string): { hhmm: string; day: number; stamp: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(now)
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
    const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const hour = get('hour') === '24' ? '00' : get('hour')
    return { hhmm: `${hour}:${get('minute')}`, day: days[get('weekday')] ?? now.getDay(), stamp: `${get('year')}-${get('month')}-${get('day')}` }
  } catch {
    return { hhmm: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, day: now.getDay(), stamp: now.toISOString().slice(0, 10) }
  }
}

const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/**
 * Une routine part à son heure, ou en rattrapage (Mac éteint ou en veille à l'heure prévue) :
 * jusqu'à 12 h après, le même jour, si elle a déjà tourné au moins une fois et pas encore aujourd'hui.
 */
export function isDue(r: Routine, now: Date): boolean {
  if (!r.enabled) return false
  const { hhmm, day, stamp } = localClock(now, r.tz)
  if (r.days.length && !r.days.includes(day)) return false
  if (r.monthDays?.length && !r.monthDays.includes(parseInt(stamp.slice(8, 10), 10))) return false
  if (r.time === hhmm) return true
  const late = toMin(hhmm) - toMin(r.time)
  if (late <= 0 || late > 12 * 60 || !r.lastRun) return false
  const last = localClock(new Date(r.lastRun), r.tz)
  return !(last.stamp === stamp && toMin(last.hhmm) >= toMin(r.time))
}

/** Planificateur : vérifie chaque minute si une routine doit partir. */
export function startScheduler(): () => void {
  const fired = new Set<string>()
  const tick = (): void => {
    for (const c of syncAll()) routineEvents.emit('routine', { office: c.office, slug: c.slug, routineId: '', status: 'synced' })
    const now = new Date()
    for (const office of listOffices()) {
      for (const a of loadOffice(office.slug).agents) {
        // Une routine à la fois par agent : au démarrage du Mac, les routines en retard partent l'une après l'autre,
        // dans l'ordre de leur heure (veille → plan → production), au lieu de toutes en même temps.
        const busy = (): boolean => [...running].some((k) => k.startsWith(`${office.slug}/${a.slug}:`))
        const ordered = [...a.routines].sort((x, y) => toMin(x.time) - toMin(y.time))
        for (const r of ordered) {
          if (!r.enabled) continue
          if (!isDue(r, now)) continue
          const { stamp } = localClock(now, r.tz)
          const key = `${office.slug}/${a.slug}:${r.id}:${stamp}`
          if (fired.has(key)) continue
          const late = r.time !== localClock(now, r.tz).hhmm
          if (late && busy()) break // rattrapage : on attend que l'agent ait fini
          fired.add(key)
          runRoutine(office.slug, a.slug, r.id).catch(() => undefined)
          if (late) break
        }
      }
    }
    if (fired.size > 2000) fired.clear()
  }
  const h = setInterval(tick, 30_000)
  tick()
  return () => clearInterval(h)
}
