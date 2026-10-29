import { app, BrowserWindow, ipcMain, dialog, shell, systemPreferences } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import type { AccessEntry, AgentConfig, NewAgentInput, OfficeLayout, QuickAction, RunnerEvent } from '../shared/types'
import { ClaudeRun, checkClaude, newSessionId, resolveClaudeBin } from './claude-runner'
import * as store from './store'
import * as reports from './reports'
import * as inbox from './inbox'
import { runRoutine, startScheduler, routineEvents, runningRoutines, stopRoutines } from './routines'
import { startMeeting, getMeeting, listMeetings, meetingEvents, meetingsRunning } from './meeting'
import { extractCandidates, resolveExisting, reveal, openFile } from './paths'
import { merge3 } from './merge'
import { getLayout, saveLayout } from './layout'
import { getActions, saveActions, ACTIONS_PROTOCOL } from './actions'
import { saveImage, readImage } from './images'
import { listAccess, saveAccess, removeAccess, accessEnv, accessSummary, ACCESS_DENY } from './access'
import { syncFromFiles, syncToFiles, PROTECTED_RULES, ROUTINE_PROTOCOL, routinesSummary, ensureReadmes, syncAll } from './routine-sync'
import { checkVoice, transcribe, speak, stopSpeaking, listVoices, installVoice } from './voice'
import * as conv from './conversations'

let win: BrowserWindow | null = null
const activeRuns = new Map<string, ClaudeRun>()
const key = (o: string, slug: string): string => `${o}/${slug}`

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: 'Oficina Virtual',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1115',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false }
  })
  // Au retour sur la fenêtre : on relit les dossiers (agents ou rutinas créés depuis l'extérieur, p. ej. par Claude Cowork).
  win.on('focus', () => {
    try { ensureReadmes(); syncAll() } catch { /* ignore */ }
    emit('routine', { office: '', slug: '', routineId: '', status: 'synced' })
    alertsChanged()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

const emit = (channel: string, payload: unknown): void => { win?.webContents.send(channel, payload) }
const alertsChanged = (): void => emit('alerts', {})

function chatSystemPrompt(o: string, a: AgentConfig): string {
  const office = store.loadOffice(o)
  return `Eres ${a.name}, ${a.role} en ${office.companyName}. Le hablas a ${office.owner}, tu jefe. Respondes en español (español neutro latinoamericano, tuteando), salvo que tu jefe te escriba en otro idioma: entonces respondes en ese idioma. Interfaz: ventana de chat, así que respuestas cortas y estructuradas, sin bloques de texto largos. Si necesitas una decisión o un dato de su parte, termina con una pregunta clara y única. Fecha: ${new Date().toLocaleDateString('es-CL')}. Actualiza memory/MEMORY.md cuando aprendas algo duradero.\n\n${ROUTINE_PROTOCOL}\n\n${ACTIONS_PROTOCOL}\n\n${routinesSummary(a)}`
}

const VOICE_PROMPT = `MODO VOZ: tu jefe te habla en voz alta y tu respuesta la lee una voz sintética, como una conversación cara a cara. Habla en español salvo que tu jefe te hable en otro idioma.
- Si tienes que usar una herramienta (leer, buscar, verificar), escribe primero UNA frase muy corta que diga lo que haces («Reviso el CRM.», «Verifico las estadísticas.»), y luego trabaja sin comentar cada paso.
- Respuesta final: 2 a 4 frases habladas, naturales, como en una conversación. Sin listas, sin markdown, sin código, sin rutas de archivo ni URL, sin emojis. Redondea los números.
- Si hace falta una decisión, termina con una sola pregunta cerrada («¿Lo lanzo?»).
- Una respuesta corta («sí», «dale», «no») se refiere a tu última propuesta: ejecútala.`

/** Modèle utilisé en mode vocal : plus rapide que Opus si l'agent n'a pas déjà un modèle rapide. */
function voiceModel(a: AgentConfig): string {
  if (a.voiceModel) return a.voiceModel
  if (a.model && /sonnet|haiku/i.test(a.model)) return a.model
  return 'sonnet'
}

async function sendToAgent(o: string, slug: string, text: string, voice = false): Promise<ClaudeRun> {
  const agent = store.loadAgent(o, slug)
  if (!agent) throw new Error('Agente desconocido')
  if (activeRuns.has(key(o, slug))) throw new Error('Este agente ya está trabajando. Espera o detenlo.')
  const [env, access] = await Promise.all([accessEnv(o, slug), accessSummary(o, agent)])
  if (activeRuns.has(key(o, slug))) throw new Error('Este agente ya está trabajando. Espera o detenlo.')
  const session = store.appendMessage(o, slug, { id: randomUUID(), role: 'user', text, at: new Date().toISOString() })
  const sid = session.sessionId
  const fresh = sid ? undefined : newSessionId()
  const mcp = store.mcpFor(o, agent)
  const run = new ClaudeRun({
    cwd: store.agentDir(o, slug), prompt: text, sessionId: sid, newSessionId: fresh,
    addDirs: store.resolveFolders(o, agent), allowedTools: [...agent.allowedTools, ...mcp.tools, ...(agent.chrome ? ['mcp__claude-in-chrome'] : [])], disallowedTools: [...agent.disallowedTools, ...PROTECTED_RULES, ...ACCESS_DENY], env,
    permissionMode: agent.permissionMode, appendSystemPrompt: chatSystemPrompt(o, agent) + `\n\n${access}` + (voice ? `\n\n${VOICE_PROMPT}` : ''), model: voice ? voiceModel(agent) : agent.model, mcpConfig: mcp.mcpConfig, strictMcp: mcp.strictMcp,
    chrome: agent.chrome === true ? true : false
  })
  activeRuns.set(key(o, slug), run)
  const ev = (p: Omit<RunnerEvent, 'office' | 'agentSlug'>): void => emit('runner', { office: o, agentSlug: slug, ...p } satisfies RunnerEvent)
  ev({ kind: 'start' })
  run.emitter.on('init', (id) => {
    const s = store.loadSession(o, slug); if (!s.sessionId) { s.sessionId = id; store.saveSession(o, slug, s) }
  })
  run.emitter.on('text', (t) => ev({ kind: 'text', text: t }))
  run.emitter.on('tool', (name, input) => {
    const short = summarizeTool(name, input)
    store.appendMessage(o, slug, { id: randomUUID(), role: 'tool', text: short, at: new Date().toISOString() })
    ev({ kind: 'tool', text: short })
  })
  run.emitter.on('done', (r) => {
    activeRuns.delete(key(o, slug))
    try { onDone(r) } catch (e) { ev({ kind: 'error', text: (e as Error).message }); ev({ kind: 'end' }) }
  })
  const onDone = (r: Parameters<Parameters<typeof run.emitter.on<'done'>>[1]>[0]): void => {
    const s = store.loadSession(o, slug)
    if (r.sessionId && !s.sessionId) s.sessionId = r.sessionId
    if (r.isError) {
      if (/No conversation found|session/i.test(r.errorText ?? '')) s.sessionId = null
      s.messages.push({ id: randomUUID(), role: 'system', text: `Error: ${r.errorText ?? 'desconocido'}`, at: new Date().toISOString() })
      store.saveSession(o, slug, s)
      ev({ kind: 'error', text: r.errorText })
    } else {
      s.messages.push({ id: randomUUID(), role: 'assistant', text: r.text, at: new Date().toISOString(), meta: { costUsd: r.costUsd, durationMs: r.durationMs } })
      store.saveSession(o, slug, s)
      ev({ kind: 'result', text: r.text, costUsd: r.costUsd, durationMs: r.durationMs, sessionId: r.sessionId ?? undefined })
    }
    ev({ kind: 'end' })
    try { if (syncFromFiles(o, slug).changed) emit('routine', { office: o, slug, routineId: '', status: 'synced' }) } catch { /* ignore */ }
    alertsChanged()
  }
  run.start()
  return run
}


function summarizeTool(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const v = (k: string): string => typeof i[k] === 'string' ? (i[k] as string) : ''
  switch (name) {
    case 'Read': case 'Write': case 'Edit': return `${name} ${path.basename(v('file_path'))}`
    case 'Bash': return `Bash ${v('command').slice(0, 90)}`
    case 'WebSearch': return `Búsqueda web: ${v('query')}`
    case 'WebFetch': return `Lectura: ${v('url')}`
    case 'Glob': case 'Grep': return `${name} ${v('pattern')}`
    default: return name
  }
}

function registerIpc(): void {
  const h = (channel: string, fn: (...args: any[]) => unknown): void => { ipcMain.handle(channel, fn) }
  h('conv:list', () => conv.listConversations())
  h('conv:thread', (_e, o: string, slug: string, limit?: number) => conv.getThread(o, slug, limit))
  h('conv:read', (_e, o: string, slug: string) => { conv.markConversationRead(o, slug); alertsChanged() })
  h('conv:unread', (_e, o: string, slug: string, unread: boolean) => { conv.setConversationUnread(o, slug, unread); alertsChanged() })
  h('offices:list', () => store.listOffices())
  h('offices:archive', (_e, o: string) => {
    if ([...activeRuns.keys()].some((k) => k.startsWith(`${o}/`)) || runningRoutines().some((r) => r.office === o)) throw new Error('Un agente de esta oficina todavía está trabajando. Espera a que termine.')
    store.archiveOffice(o)
    alertsChanged()
  })
  // Bureau ou agent ajouté/modifié/retiré : on prévient l'app (la messagerie se recharge toute seule).
  h('offices:create', (_e, name: string, owner: string, color: string) => { const m = store.createOffice(name, owner, color); alertsChanged(); return m })
  h('office:get', (_e, o: string) => store.loadOffice(o))
  h('alerts:office', (_e, o: string) => inbox.officeAlerts(o))
  h('alerts:all', () => inbox.allAlerts())
  h('agent:get', (_e, o: string, slug: string) => store.loadAgent(o, slug))
  h('session:get', (_e, o: string, slug: string) => store.loadSession(o, slug))
  h('session:seen', (_e, o: string, slug: string) => { store.markSeen(o, slug); alertsChanged() })
  // Le ClaudeRun (process, callbacks) n'est pas clonable par l'IPC : on ne renvoie que des données simples.
  h('agent:send', async (_e, o: string, slug: string, text: string, opts?: { voice?: boolean }) => { await sendToAgent(o, slug, text, opts?.voice === true); return { ok: true } })
  h('agent:stop', (_e, o: string, slug: string) => {
    const k = key(o, slug)
    activeRuns.get(k)?.stop()
    stopRoutines(o, slug)
    // Quoi qu'il arrive, on libère l'affichage : plus de bouton Stop qui ne fait rien.
    setTimeout(() => {
      if (activeRuns.has(k)) { activeRuns.delete(k); store.appendMessage(o, slug, { id: randomUUID(), role: 'system', text: 'Detenido a la fuerza.', at: new Date().toISOString() }) }
      emit('runner', { office: o, agentSlug: slug, kind: 'end' } satisfies RunnerEvent)
    }, 500)
  })
  h('session:reset', (_e, o: string, slug: string) => {
    store.saveSession(o, slug, { sessionId: null, messages: [{ id: randomUUID(), role: 'system', text: 'Nueva conversación. La memoria larga (memory/MEMORY.md) se conserva.', at: new Date().toISOString() }] })
    alertsChanged()
  })
  h('agent:create', (_e, o: string, input: NewAgentInput) => { const a = store.createAgent(o, input); alertsChanged(); return a })
  h('agent:update', (_e, o: string, a: AgentConfig) => { store.saveAgent(o, a); const r = syncToFiles(o, a); alertsChanged(); return r })
  h('agent:patch', (_e, o: string, slug: string, changes: Record<string, { prev: unknown; next: unknown }>) => {
    const fresh = store.loadAgent(o, slug) as unknown as Record<string, unknown> | null
    if (!fresh) throw new Error('Agente desconocido')
    const next: Record<string, unknown> = { ...fresh }
    for (const [k, c] of Object.entries(changes)) next[k] = merge3(fresh[k], c.prev, c.next)
    next.slug = slug
    store.saveAgent(o, next as unknown as AgentConfig)
    return syncToFiles(o, next as unknown as AgentConfig)
  })
  h('agent:delete', (_e, o: string, slug: string) => { const r = store.deleteAgent(o, slug); alertsChanged(); return r })
  h('layout:get', (_e, o: string) => getLayout(o))
  h('layout:save', (_e, o: string, l: OfficeLayout) => saveLayout(o, l))
  h('access:list', (_e, o: string, slug: string) => listAccess(o, slug))
  h('access:save', (_e, o: string, slug: string, entry: Partial<AccessEntry> & { name: string }, secret?: string) => saveAccess(o, slug, entry, secret))
  h('access:remove', (_e, o: string, slug: string, id: string) => removeAccess(o, slug, id))
  h('shell:url', (_e, url: string) => { if (/^https?:\/\//i.test(url)) return shell.openExternal(url) })
  h('actions:get', (_e, o: string, slug: string) => { const a = store.loadAgent(o, slug); return a ? getActions(o, a) : [] })
  h('actions:save', (_e, o: string, slug: string, list: QuickAction[]) => saveActions(o, slug, list))
  h('memory:read', (_e, o: string, slug: string) => store.readMemory(o, slug))
  h('claudemd:read', (_e, o: string, slug: string) => store.readClaudeMd(o, slug))
  h('claudemd:write', (_e, o: string, slug: string, c: string) => store.writeClaudeMd(o, slug, c))
  h('routine:run', (_e, o: string, slug: string, id: string) => { runRoutine(o, slug, id).catch((err) => emit('routine', { office: o, slug, routineId: id, status: 'error:' + err.message })) })
  h('routine:read', (_e, o: string, slug: string, f: string) => store.readRoutine(o, slug, f))
  h('routine:write', (_e, o: string, slug: string, f: string, c: string) => store.writeRoutine(o, slug, f, c))
  h('reports:list', (_e, o: string) => reports.listReports(o))
  h('reports:read', (_e, o: string, slug: string, file: string) => reports.readReport(o, slug, file))
  h('reports:markRead', (_e, o: string, slug: string, file: string) => { reports.markRead(o, slug, file); alertsChanged() })
  h('inbox:list', (_e, o: string, slug: string) => inbox.listInbox(o, slug))
  h('inbox:read', (_e, o: string, slug: string, file: string) => inbox.readInbox(o, slug, file))
  h('inbox:markRead', (_e, o: string, slug: string, file: string) => { inbox.markInboxRead(o, slug, file); alertsChanged() })
  h('meeting:start', (_e, o: string, topic: string, p: string[]) => startMeeting(o, topic, p))
  h('meeting:get', (_e, o: string, id: string) => getMeeting(o, id))
  h('meeting:list', (_e, o: string) => listMeetings(o))
  h('skills:list', (_e, o: string, slug: string) => store.listSkills(o, slug))
  h('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  h('shell:open', (_e, p: string) => { if (fs.existsSync(p)) shell.openPath(p) })
  h('mcp:auth', (_e, o: string, slug: string) => {
    const a = store.loadAgent(o, slug)
    if (!a) return
    const { mcpConfig, strictMcp } = store.mcpFor(o, a)
    if (!mcpConfig || process.platform !== 'darwin') return
    const dir = store.agentDir(o, slug).replace(/'/g, "'\\''")
    const cmd = `cd '${dir}' && clear && echo 'Conectores de ${a.name.replace(/'/g, '')}: escribe /mcp, elige el conector, Authenticate y luego /exit.' && '${resolveClaudeBin().replace(/'/g, '')}' --mcp-config .mcp.json${strictMcp ? ' --strict-mcp-config' : ''}`
    const script = `tell application "Terminal"\n activate\n do script "${cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\nend tell`
    spawn('/usr/bin/osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref()
  })
  h('paths:find', (_e, o: string, slug: string, text: string) => resolveExisting(o, slug, extractCandidates(text)))
  h('paths:reveal', (_e, abs: string) => reveal(abs))
  h('paths:open', (_e, abs: string) => openFile(abs))
  h('claude:check', () => checkClaude())
  h('voice:check', () => checkVoice())
  h('voice:askMic', async () => {
    if (process.platform !== 'darwin') return true
    const st = systemPreferences.getMediaAccessStatus('microphone')
    if (st === 'granted') return true
    if (st === 'denied' || st === 'restricted') return false
    return systemPreferences.askForMediaAccess('microphone').catch(() => false)
  })
  let voiceInstalling = false
  h('voice:install', async () => {
    if (voiceInstalling) return
    voiceInstalling = true
    const ok = await installVoice((line) => emit('voice-install', { line }))
    voiceInstalling = false
    emit('voice-install', { done: true, ok, status: checkVoice() })
  })
  h('voice:speak', (_e, text: string, voice?: string) => speak(text, voice))
  h('voice:stop', () => stopSpeaking())
  h('voice:voices', () => listVoices())
  h('voice:openSettings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.universalaccess?SpokenContent'))
  h('image:save', (_e, o: string, slug: string, data: Uint8Array, mime: string) => saveImage(o, slug, data, mime))
  h('image:read', (_e, o: string, slug: string, rel: string) => readImage(o, slug, rel))
  h('voice:transcribe', async (_e, o: string, slug: string, audio: Uint8Array, mime: string) => {
    if (process.platform === 'darwin') {
      const ok = await systemPreferences.askForMediaAccess('microphone').catch(() => true)
      if (!ok) return { text: '', error: 'Acceso al micrófono denegado. Ajustes del Sistema → Privacidad y seguridad → Micrófono → Oficina Virtual.' }
    }
    return transcribe(o, slug, audio, mime)
  })
  routineEvents.on('routine', (ev) => { emit('routine', ev); alertsChanged() })
  meetingEvents.on('meeting', (m) => { emit('meeting', m); alertsChanged() })
}

// Mode headless : `electron . --routine=<office>/<slug>:<routineId>` (launchd quand l'app est fermée).
const routineArg = process.argv.find((a) => a.startsWith('--routine='))?.slice('--routine='.length)
  ?? (process.argv.includes('--routine') ? process.argv[process.argv.indexOf('--routine') + 1] : undefined)

app.whenReady().then(async () => {
  store.migrate()
  store.ensureStarterOffice()
  try { ensureReadmes(); syncAll() } catch { /* ignore */ }
  if (routineArg) {
    const m = routineArg.match(/^(?:([^/]+)\/)?([^:]+):(.+)$/)
    if (!m) { console.error('formato esperado: <office>/<slug>:<routineId>'); app.quit(); return }
    const office = m[1] ?? store.listOffices()[0]?.slug
    try { await runRoutine(office, m[2], m[3]); console.log(`rutina ${routineArg}: ok`) }
    catch (e) { console.error(`rutina ${routineArg}: ${(e as Error).message}`); process.exitCode = 1 }
    app.quit()
    return
  }
  registerIpc()
  createWindow()
  const stop = startScheduler()
  app.on('before-quit', () => { stop() })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
