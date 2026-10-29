// Transcription locale des vocaux : ffmpeg (conversion) + whisper.cpp (reconnaissance).
// Installation : bash scripts/install-voice.sh
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import type { VoiceStatus } from '../shared/types'
import { agentDir, projectRoot } from './store'
import { buildEnv } from './claude-runner'

const home = (): string => process.env.HOME ?? os.homedir()

function findBin(names: string[]): string | null {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', `${home()}/.local/bin`, '/usr/bin']
  for (const n of names) for (const d of dirs) {
    const p = path.join(d, n)
    if (fs.existsSync(p)) return p
  }
  return null
}

export function modelPath(): string | null {
  const candidates = [
    process.env.WHISPER_MODEL ?? '',
    path.join(projectRoot(), 'models', 'ggml-small.bin'),
    path.join(projectRoot(), 'models', 'ggml-base.bin'),
    path.join(home(), '.oficina-virtual', 'models', 'ggml-small.bin'),
    '/opt/homebrew/share/whisper-cpp/models/ggml-small.bin'
  ].filter(Boolean)
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

export function checkVoice(): VoiceStatus {
  const ffmpeg = !!findBin(['ffmpeg'])
  const whisper = !!findBin(['whisper-cli', 'whisper-cpp', 'main'])
  const model = !!modelPath()
  const ok = ffmpeg && whisper && model
  return {
    ok, ffmpeg, whisper, model,
    hint: ok ? undefined : `Los mensajes de voz todavía no están instalados (falta: ${[!ffmpeg && 'ffmpeg', !whisper && 'whisper', !model && 'modelo de reconocimiento'].filter(Boolean).join(', ')}).`
  }
}

function run(bin: string, args: string[], timeout = 180_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { env: buildEnv(), timeout, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)}: ${stderr?.toString().trim() || err.message}`))
      else resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/** Sauvegarde le vocal dans workspace/audios/ de l'agent, le convertit et le transcrit. */
export async function transcribe(o: string, slug: string, audio: Uint8Array, mime: string): Promise<{ text: string; error?: string }> {
  const status = checkVoice()
  if (!status.ok) return { text: '', error: status.hint }
  const ffmpeg = findBin(['ffmpeg'])!
  const whisper = findBin(['whisper-cli', 'whisper-cpp', 'main'])!
  const model = modelPath()!

  const dir = path.join(agentDir(o, slug), 'workspace', 'audios')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'
  const src = path.join(dir, `${stamp}.${ext}`)
  const wav = path.join(os.tmpdir(), `bv-${stamp}.wav`)
  fs.writeFileSync(src, Buffer.from(audio))

  try {
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], 60_000)
    const { stdout } = await run(whisper, ['-m', model, '-l', process.env.OFICINA_VOICE_LANG || 'auto', '-nt', '-np', '-f', wav])
    const text = stdout.split('\n').map((l) => l.replace(/^\[.*?\]\s*/, '').trim()).filter(Boolean).join(' ').trim()
    fs.writeFileSync(src.replace(/\.[a-z0-9]+$/, '.txt'), text)
    return { text }
  } catch (e) {
    return { text: '', error: (e as Error).message }
  } finally {
    try { fs.unlinkSync(wav) } catch { /* ignore */ }
  }
}

// ---- Synthèse vocale (macOS `say`), pour le mode conversation.
import { spawn, ChildProcess } from 'child_process'
let speaking: ChildProcess | null = null

/** Nettoie le markdown pour que ce soit agréable à écouter. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (bloque de código) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'enlace')
    .replace(/(?:~|\.{0,2}\/)?(?:[\w.-]+\/){2,}[\w.-]+/g, 'el archivo')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 4000)
}

export function stopSpeaking(): void {
  if (speaking) { speaking.kill('SIGTERM'); speaking = null }
}

let bestVoice: string | null = null
/** Meilleure voix espagnole installée : Premium > Améliorée, accent chilien puis latino-américain d'abord. */
export async function defaultVoice(): Promise<string> {
  if (bestVoice) return bestVoice
  const list = await listVoices()
  const score = (v: string): number => (/premium/i.test(v) ? 100 : /enhanced|mejorad|amélior/i.test(v) ? 50 : 0) + (/francisca/i.test(v) ? 20 : /paulina|juan|diego|isabela|soledad|marisol|ang[eé]lica/i.test(v) ? 10 : 0)
  bestVoice = list.sort((a, b) => score(b) - score(a))[0] ?? 'Paulina'
  return bestVoice
}

export async function speak(text: string, voice?: string): Promise<void> {
  stopSpeaking()
  const clean = speakable(text)
  if (!voice) voice = await defaultVoice()
  if (!clean || process.platform !== 'darwin') return Promise.resolve()
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/say', ['-v', voice, '-r', '185', clean])
    speaking = child
    child.on('exit', () => { if (speaking === child) speaking = null; resolve() })
    child.on('error', () => { speaking = null; resolve() })
  })
}

export function listVoices(): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve([])
    execFile('/usr/bin/say', ['-v', '?'], (err, stdout) => {
      if (err) return resolve([])
      bestVoice = null
      const es = stdout.toString().split('\n').filter((l) => /\bes_(?:[A-Z]{2}|419)\b/.test(l)).map((l) => l.split(/\s{2,}/)[0].trim()).filter(Boolean)
      resolve(es)
    })
  })
}

/** Lance scripts/install-voice.sh et remonte chaque ligne de log. */
export function installVoice(onLine: (l: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const script = path.join(projectRoot(), 'scripts', 'install-voice.sh')
    const child = spawn('/bin/bash', [script], {
      cwd: projectRoot(),
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ''}` }
    })
    const feed = (b: Buffer): void => { for (const l of b.toString().split(/\r?\n/)) if (l.trim()) onLine(l.trim()) }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', (e) => { onLine(`ERROR: ${e.message}`); resolve(false) }) // préfixe ERROR: lu par l'écran d'installation
  })
}
