// Images collées dans la conversation : rangées dans agents/<slug>/captures/, lues par l'agent avec Read.
import fs from 'fs'
import path from 'path'
import { agentDir } from './store'

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const MAX = 15 * 1024 * 1024

export function saveImage(o: string, slug: string, data: Uint8Array, mime: string): string {
  const ext = EXT[mime]
  if (!ext) throw new Error('Formato no compatible (PNG, JPG, WebP o GIF)')
  if (data.byteLength > MAX) throw new Error('Imagen demasiado pesada (máx. 15 MB)')
  const dir = path.join(agentDir(o, slug), 'captures')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  let name = `${stamp}.${ext}`, i = 2
  while (fs.existsSync(path.join(dir, name))) name = `${stamp}-${i++}.${ext}`
  fs.writeFileSync(path.join(dir, name), Buffer.from(data))
  return `captures/${name}`
}

/** Miniature pour l'affichage : uniquement des fichiers du dossier captures/ de l'agent. */
export function readImage(o: string, slug: string, rel: string): string | null {
  if (!/^captures\/[\w.-]+\.(png|jpg|webp|gif)$/.test(rel)) return null
  const f = path.join(agentDir(o, slug), rel)
  if (!fs.existsSync(f)) return null
  const ext = rel.split('.').pop() as string
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  return `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`
}
