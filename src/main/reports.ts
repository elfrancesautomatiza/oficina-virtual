// Rapports quotidiens par agent + logique de condensation :
// si des rapports non lus existent quand un nouveau arrive, ils sont fusionnés en un seul.
import fs from 'fs'
import path from 'path'
import type { Report } from '../shared/types'
import { agentDir, agentsDir, readJson, writeJson } from './store'

interface ReportIndex { [file: string]: { read: boolean; title: string; condensedFrom?: number } }

const indexFile = (o: string, slug: string): string => path.join(agentDir(o, slug), 'reports', 'index.json')
const reportsPath = (o: string, slug: string): string => path.join(agentDir(o, slug), 'reports')

export function listReports(o: string): Report[] {
  const out: Report[] = []
  if (!fs.existsSync(agentsDir(o))) return out
  for (const slug of fs.readdirSync(agentsDir(o))) {
    const dir = reportsPath(o, slug)
    if (!fs.existsSync(dir)) continue
    const idx = readJson<ReportIndex>(indexFile(o, slug), {})
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse()) {
      const meta = idx[file] ?? { read: false, title: titleOf(path.join(dir, file)) }
      out.push({ office: o, agentSlug: slug, file, date: file.slice(0, 10), title: meta.title, read: meta.read, condensedFrom: meta.condensedFrom })
    }
  }
  return out.sort((a, b) => (a.file < b.file ? 1 : -1))
}

export function readReport(o: string, slug: string, file: string): string {
  const f = path.join(reportsPath(o, slug), path.basename(file))
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}

export function markRead(o: string, slug: string, file: string): void {
  const idx = readJson<ReportIndex>(indexFile(o, slug), {})
  idx[file] = { ...(idx[file] ?? { title: titleOf(path.join(reportsPath(o, slug), file)) }), read: true }
  writeJson(indexFile(o, slug), idx)
}

/** Rapports non lus d'un agent, avec leur contenu. */
export function unreadReports(o: string, slug: string): Array<{ file: string; content: string }> {
  const dir = reportsPath(o, slug)
  if (!fs.existsSync(dir)) return []
  const idx = readJson<ReportIndex>(indexFile(o, slug), {})
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .filter((f) => !(idx[f]?.read))
    .map((f) => ({ file: f, content: fs.readFileSync(path.join(dir, f), 'utf8') }))
}

/**
 * Enregistre un nouveau rapport. Si `condensedFiles` est fourni, ces anciens rapports non lus
 * sont archivés : il ne reste qu'un seul rapport non lu.
 */
export function registerReport(o: string, slug: string, file: string, condensedFiles: string[] = []): void {
  const dir = reportsPath(o, slug)
  const idx = readJson<ReportIndex>(indexFile(o, slug), {})
  const full = path.join(dir, file)
  if (!fs.existsSync(full)) return
  if (condensedFiles.length) {
    const archive = path.join(dir, 'archive')
    fs.mkdirSync(archive, { recursive: true })
    for (const old of condensedFiles) {
      if (old === file) continue
      const src = path.join(dir, old)
      if (fs.existsSync(src)) fs.renameSync(src, path.join(archive, old))
      delete idx[old]
    }
  }
  idx[file] = { read: false, title: titleOf(full), condensedFrom: condensedFiles.length || undefined }
  writeJson(indexFile(o, slug), idx)
}

export function todayReportName(prefix = 'rapport'): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${stamp}-${prefix}.md`
}

/** Construit l'instruction de condensation injectée dans le prompt d'une routine. */
export function condensationInstruction(o: string, slug: string, newFile: string): { text: string; files: string[] } {
  const unread = unreadReports(o, slug)
  if (!unread.length) {
    return { text: `Escribe tu informe del día en \`reports/${newFile}\` (título en la primera línea \`# ...\`), en español salvo que tu jefe te escriba en otro idioma.`, files: [] }
  }
  const files = unread.map((u) => u.file)
  const dump = unread.map((u) => `--- ${u.file} ---\n${u.content}`).join('\n\n')
  return {
    files,
    text: `Tu jefe NO leyó tus ${unread.length} informe(s) anterior(es). Regla: solo puede haber un informe sin leer.
Escribe en \`reports/${newFile}\` UN SOLO informe que condense los anteriores Y el trabajo de hoy, en español salvo que tu jefe te escriba en otro idioma:
- Conserva las cifras y tendencias, elimina el relleno.
- Una sección "Desde el ${unread[0].file.slice(0, 10)}" con lo que de verdad importa, luego "Hoy", luego "Decisiones que esperan de ti".
- Título en la primera línea \`# ...\`.
Los informes antiguos se archivarán automáticamente. Este es su contenido:

${dump}`
  }
}

function titleOf(file: string): string {
  try {
    const first = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.trim().startsWith('#'))
    return first ? first.replace(/^#+\s*/, '').trim() : path.basename(file, '.md')
  } catch { return path.basename(file, '.md') }
}
