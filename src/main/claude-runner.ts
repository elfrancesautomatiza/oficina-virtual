// Pilote le CLI `claude` en mode non interactif (-p) avec sortie stream-json.
// Un process par message. La session est reprise avec --resume, donc chaque agent
// garde sa propre conversation (stockée par Claude Code, indexée par le cwd de l'agent).
import { spawn, ChildProcess, execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type { PermissionMode } from '../shared/types'

export interface RunOptions {
  cwd: string
  prompt: string
  sessionId?: string | null
  /** Si fourni sans sessionId, force l'ID de la nouvelle session. */
  newSessionId?: string
  addDirs?: string[]
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode?: PermissionMode
  appendSystemPrompt?: string
  model?: string
  maxTurns?: number
  noPersist?: boolean
  /** Chemin d'un fichier .mcp.json : seuls ces serveurs sont chargés. */
  mcpConfig?: string
  /** false = garder aussi les connecteurs du compte claude.ai (sinon seuls ceux de mcpConfig) */
  strictMcp?: boolean
  /** true = --chrome, false = --no-chrome, undefined = laisser Claude Code décider */
  chrome?: boolean
  /** Variables d'environnement en plus (accès du coffre) */
  env?: Record<string, string>
  /** Arrêt automatique après ce délai sans aucune sortie de claude (défaut 15 min, 0 = jamais). */
  idleTimeoutMs?: number
}

export const DEFAULT_IDLE_MS = 15 * 60 * 1000

export interface RunResult {
  sessionId: string | null
  text: string
  costUsd?: number
  durationMs?: number
  isError: boolean
  errorText?: string
}

export type RunnerEmitter = EventEmitter & {
  on(ev: 'text', cb: (t: string) => void): RunnerEmitter
  on(ev: 'tool', cb: (name: string, input: unknown) => void): RunnerEmitter
  on(ev: 'init', cb: (sessionId: string) => void): RunnerEmitter
  on(ev: 'done', cb: (r: RunResult) => void): RunnerEmitter
}

/** Résout le binaire claude. Electron lancé depuis le Dock n'a pas le PATH du shell. */
export function resolveClaudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  const home = process.env.HOME ?? ''
  const candidates = [
    `${home}/.claude/local/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    `${home}/.local/bin/claude`,
    `${home}/.npm-global/bin/claude`,
    '/usr/bin/claude'
  ]
  const fs = require('fs') as typeof import('fs')
  for (const c of candidates) if (fs.existsSync(c)) return c
  return 'claude'
}

export function buildEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME ?? ''
  const extra = [
    '/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`,
    `${home}/.npm-global/bin`, `${home}/.claude/local`, '/usr/bin', '/bin'
  ]
  const path = [...new Set([...(process.env.PATH ?? '').split(':'), ...extra])].filter(Boolean).join(':')
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: path }
  // On veut l'abonnement, pas une clé API qui traînerait dans l'environnement.
  delete env.ANTHROPIC_API_KEY
  return env
}

export function checkClaude(): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(resolveClaudeBin(), ['--version'], { env: buildEnv(), timeout: 15000 }, (err, stdout) => {
      if (err) resolve({ ok: false, error: `${err.message}. Instala Claude Code (npm i -g @anthropic-ai/claude-code) y ejecuta \`claude\` una vez para iniciar sesión.` })
      else resolve({ ok: true, version: stdout.trim() })
    })
  })
}

export function buildArgs(o: RunOptions): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose']
  if (o.sessionId) args.push('--resume', o.sessionId)
  else if (o.newSessionId) args.push('--session-id', o.newSessionId)
  if (o.noPersist) args.push('--no-session-persistence')
  if (o.permissionMode) args.push('--permission-mode', o.permissionMode)
  if (o.model) args.push('--model', o.model)
  if (o.maxTurns) args.push('--max-turns', String(o.maxTurns))
  if (o.addDirs?.length) args.push('--add-dir', ...o.addDirs)
  if (o.allowedTools?.length) args.push('--allowedTools', o.allowedTools.join(','))
  if (o.disallowedTools?.length) args.push('--disallowedTools', o.disallowedTools.join(','))
  if (o.appendSystemPrompt) args.push('--append-system-prompt', o.appendSystemPrompt)
  if (o.mcpConfig) args.push('--mcp-config', o.mcpConfig)
  if (o.mcpConfig && o.strictMcp !== false) args.push('--strict-mcp-config')
  if (o.chrome === true) args.push('--chrome')
  else if (o.chrome === false) args.push('--no-chrome')
  // Le prompt passe par stdin pour éviter les limites d'arguments.
  return args
}

/** Extrait les blocs utiles d'un événement stream-json. Exporté pour les tests. */
export function parseEvent(line: string): Array<
  | { kind: 'init'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'result'; text: string; isError: boolean; sessionId?: string; costUsd?: number; durationMs?: number }
> {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return []
  let ev: any
  try { ev = JSON.parse(trimmed) } catch { return [] }
  const out: ReturnType<typeof parseEvent> = []
  if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) {
    out.push({ kind: 'init', sessionId: ev.session_id })
  } else if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
    for (const block of ev.message.content) {
      if (block.type === 'text' && block.text) out.push({ kind: 'text', text: block.text })
      else if (block.type === 'tool_use') out.push({ kind: 'tool', name: block.name, input: block.input })
    }
  } else if (ev.type === 'result') {
    out.push({
      kind: 'result',
      text: typeof ev.result === 'string' ? ev.result : '',
      isError: ev.is_error === true || (ev.subtype && ev.subtype !== 'success'),
      sessionId: ev.session_id,
      costUsd: ev.total_cost_usd,
      durationMs: ev.duration_ms
    })
  }
  return out
}

export class ClaudeRun {
  readonly emitter: RunnerEmitter = new EventEmitter() as RunnerEmitter
  private child: ChildProcess | null = null
  private buffer = ''
  private textParts: string[] = []
  private sessionId: string | null
  private finished = false
  private stderr = ''
  private lastActivity = Date.now()
  private watchdog: NodeJS.Timeout | null = null
  private exited = false

  constructor(private opts: RunOptions) {
    this.sessionId = opts.sessionId ?? opts.newSessionId ?? null
  }

  start(): this {
    const args = buildArgs(this.opts)
    this.child = spawn(resolveClaudeBin(), args, {
      cwd: this.opts.cwd,
      env: { ...buildEnv(), ...(this.opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    // Si claude quitte avant d'avoir lu stdin (pas connecté, mauvais flag…), l'écriture lève EPIPE :
    // on l'ignore, l'erreur utile arrive par stderr / le code de sortie.
    this.child.stdin?.on('error', () => undefined)
    this.child.stdin?.end(this.opts.prompt)
    this.child.stdout?.setEncoding('utf8')
    this.child.stdout?.on('data', (chunk: string) => { this.lastActivity = Date.now(); this.onData(chunk) })
    this.child.stderr?.setEncoding('utf8')
    // Seule la sortie de claude compte comme activité : un serveur MCP qui bavarde sur stderr ne doit pas masquer un blocage.
    this.child.stderr?.on('data', (c: string) => { this.stderr = (this.stderr + c).slice(-20_000) })
    const idle = this.opts.idleTimeoutMs ?? DEFAULT_IDLE_MS
    if (idle > 0) {
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastActivity > idle) {
          this.writeDiagnostic(idle)
          this.stop(`Sin actividad desde hace ${Math.round(idle / 60000)} min: detenido automáticamente. El trabajo ya hecho (archivos, borradores) se conserva; vuelve a enviar tu pedido si hace falta.`)
        }
      }, 30_000)
    }
    this.child.on('error', (err) => this.finish({ isError: true, errorText: err.message }))
    this.child.on('close', (code) => {
      this.exited = true
      if (this.buffer.trim()) this.onData('\n')
      if (!this.finished) {
        this.finish({ isError: code !== 0, errorText: code !== 0 ? (this.stderr.trim() || `claude terminó con el código ${code}`) : undefined })
      }
    })
    return this
  }

  /** Trace d'un blocage dans logs/ de l'agent : derniers événements et fin de stderr. */
  private writeDiagnostic(idle: number): void {
    try {
      const fs = require('fs') as typeof import('fs')
      const path = require('path') as typeof import('path')
      const dir = path.join(this.opts.cwd, 'logs')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-bloqueo.md`),
        `# Bloqueo: sin salida desde hace ${Math.round(idle / 60000)} min\n\nProceso todavía vivo: ${!this.exited}\nTexto en memoria: ${this.buffer.length} caracteres sin terminar\n\n## Últimos eventos\n${this.trail.join('\n')}\n\n## Final de stderr\n\`\`\`\n${this.stderr.slice(-3000)}\n\`\`\`\n`)
    } catch { /* ignore */ }
  }

  /** Arrête le process (SIGTERM puis SIGKILL) et termine tout de suite, même si claude ne répond plus. */
  stop(reason = 'Detenido a tu pedido. El trabajo ya hecho (archivos, borradores) se conserva.'): void {
    this.kill()
    this.finish({ isError: true, errorText: reason })
  }

  private kill(): void {
    const c = this.child
    if (!c || this.exited) return
    try { c.kill('SIGTERM') } catch { /* déjà mort */ }
    setTimeout(() => { if (!this.exited) try { c.kill('SIGKILL') } catch { /* ignore */ } }, 4000).unref?.()
  }

  /** Derniers événements reçus (type + outil), pour comprendre un blocage. */
  private trail: string[] = []

  private onData(chunk: string): void {
    this.buffer += chunk
    if (!chunk.includes('\n')) return // ligne géante en cours (gros résultat d'outil) : on attend la fin
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = /"type":"([a-z_]+)"/.exec(line.slice(0, 200))?.[1]
      if (t) { this.trail.push(`${new Date().toISOString().slice(11, 19)} ${t} (${line.length} car.)`); if (this.trail.length > 25) this.trail.shift() }
      for (const ev of parseEvent(line)) {
        if (ev.kind === 'init') { this.sessionId = ev.sessionId; this.emitter.emit('init', ev.sessionId) }
        else if (ev.kind === 'text') { this.textParts.push(ev.text); this.emitter.emit('text', ev.text) }
        else if (ev.kind === 'tool') this.emitter.emit('tool', ev.name, ev.input)
        else if (ev.kind === 'result') {
          if (ev.sessionId) this.sessionId = ev.sessionId
          this.finish({ isError: ev.isError, errorText: ev.isError ? (ev.text || this.stderr.trim()) : undefined, costUsd: ev.costUsd, durationMs: ev.durationMs, resultText: ev.text })
        }
      }
    }
  }

  private finish(p: { isError: boolean; errorText?: string; costUsd?: number; durationMs?: number; resultText?: string }): void {
    if (this.finished) return
    this.finished = true
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null }
    // Résultat reçu mais le process traîne (serveur MCP accroché…) : on le libère.
    setTimeout(() => this.kill(), 20_000).unref?.()
    const text = this.textParts.join('\n').trim() || p.resultText || ''
    this.emitter.emit('done', {
      sessionId: this.sessionId, text, costUsd: p.costUsd, durationMs: p.durationMs,
      isError: p.isError, errorText: p.errorText
    } satisfies RunResult)
  }
}

/** Version promesse, pour les routines et les réunions. */
export function runOnce(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const run = new ClaudeRun(opts)
    run.emitter.on('done', resolve)
    run.start()
  })
}

export const newSessionId = (): string => randomUUID()
