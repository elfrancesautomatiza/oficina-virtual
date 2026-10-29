// Repère et ouvre les fichiers cités par un agent dans ses messages.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { shell } from 'electron'
import { agentDir, officeDir, projectRoot } from './store'

export interface FoundPath { raw: string; abs: string; isDir: boolean; name: string; editable: boolean }

const TEXT_EXT = new Set(['.json', '.md', '.txt', '.csv', '.conf', '.env', '.yaml', '.yml', '.toml', '.ini', '.log', '.html', '.xml', '.tsv'])
const SAFE_OPEN_EXT = new Set([...TEXT_EXT, '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.mp4', '.mov', '.m4a', '.mp3', '.wav', '.webm', '.xlsx', '.docx', '.pptx'])

/** Extrait du texte les candidats chemins : blocs de code, `inline`, /Users/..., chemins relatifs a/b/c.ext */
export function extractCandidates(text: string): string[] {
  const out = new Set<string>()
  const clean = (s: string): string => s.trim().replace(/^["'`(]+|["'`).,;:!?]+$/g, '').trim()
  for (const block of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of block[1].split('\n')) { const c = clean(line); if (c && !c.includes('  ') && c.length < 400) out.add(c) }
  }
  for (const m of text.matchAll(/`([^`\n]+)`/g)) out.add(clean(m[1]))
  for (const m of text.matchAll(/(?:^|[\s:(])(~?\/[A-Za-z][^\n`<>"]*\/[^\n`<>"]+)/gm)) out.add(clean(m[1]))
  for (const m of text.matchAll(/(?:^|[\s(])((?:[\w.-]+\/)+[\w.-]+)/g)) out.add(clean(m[1]))
  return [...out].filter((c) => c.includes('/') && !/^https?:/i.test(c) && !c.includes('://')).slice(0, 30)
}

/** Résout les candidats qui existent vraiment : absolus, ~, ou relatifs au dossier de l'agent / du bureau / du projet. */
export function resolveExisting(o: string, slug: string, candidates: string[]): FoundPath[] {
  const bases = [agentDir(o, slug), officeDir(o), projectRoot()]
  const found: FoundPath[] = []
  const seen = new Set<string>()
  for (const raw of candidates) {
    let tries: string[]
    if (raw.startsWith('~/')) tries = [path.join(os.homedir(), raw.slice(2))]
    else if (path.isAbsolute(raw)) tries = [raw]
    else tries = bases.map((b) => path.join(b, raw.replace(/^\.\//, '')))
    for (let t of tries) {
      t = path.normalize(t)
      // Le texte peut avoir été coupé : on essaie aussi en retirant des mots à la fin.
      let probe = t
      for (let i = 0; i < 6 && probe.length > 1 && !fs.existsSync(probe); i++) {
        const trimmed = probe.replace(/[.,;:!?)]+$/, '')
        probe = trimmed !== probe ? trimmed : probe.replace(/\s+\S*$/, '')
      }
      if (!fs.existsSync(probe) || seen.has(probe)) continue
      if (probe === os.homedir() || probe === '/' ) continue
      seen.add(probe)
      const isDir = fs.statSync(probe).isDirectory()
      found.push({ raw, abs: probe, isDir, name: path.basename(probe), editable: !isDir && TEXT_EXT.has(path.extname(probe).toLowerCase()) })
      break
    }
    if (found.length >= 8) break
  }
  return found
}

/** Ouvre le Finder sur le fichier (sélectionné) ou dans le dossier. */
export function reveal(abs: string): void {
  if (!fs.existsSync(abs)) return
  if (fs.statSync(abs).isDirectory()) shell.openPath(abs)
  else shell.showItemInFolder(abs)
}

/** Ouvre un fichier : TextEdit pour le texte, appli par défaut pour images/PDF/vidéos. Jamais d'exécutable. */
export function openFile(abs: string): boolean {
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return false
  const ext = path.extname(abs).toLowerCase()
  if (TEXT_EXT.has(ext)) {
    if (process.platform === 'darwin') { spawn('/usr/bin/open', ['-e', abs], { detached: true, stdio: 'ignore' }).unref(); return true }
    shell.openPath(abs); return true
  }
  if (SAFE_OPEN_EXT.has(ext)) { shell.openPath(abs); return true }
  shell.showItemInFolder(abs) // extension inconnue ou exécutable : on montre, on n'exécute pas
  return false
}
