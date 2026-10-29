// Fusion à trois voies : ce que la fenêtre Réglages a vu (prev), ce qu'elle veut (next),
// et ce qui est sur le disque maintenant (fresh). Rien de ce qui a été ajouté ailleurs n'est perdu.
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hasIds = (v: unknown): v is Array<{ id: string }> => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string')

export function merge3(fresh: unknown, prev: unknown, next: unknown): unknown {
  if (same(prev, next)) return fresh
  if (same(fresh, prev)) return next
  // Listes d'objets avec id (routines)
  if (hasIds(fresh) && hasIds(prev) && hasIds(next)) {
    const p = new Map(prev.map((x) => [x.id, x])); const n = new Map(next.map((x) => [x.id, x]))
    const out: Array<{ id: string }> = []
    for (const item of next) {
      const f = fresh.find((x) => x.id === item.id)
      out.push(f ? (merge3(f, p.get(item.id), item) as { id: string }) : item)
    }
    for (const f of fresh) if (!n.has(f.id) && !p.has(f.id)) out.push(f) // ajouté ailleurs entre-temps
    return out
  }
  // Listes simples (outils, dossiers, connecteurs)
  if (Array.isArray(fresh) && Array.isArray(prev) && Array.isArray(next)) {
    const removed = prev.filter((x) => !next.some((y) => same(x, y)))
    const added = next.filter((x) => !prev.some((y) => same(x, y)))
    const out = fresh.filter((x) => !removed.some((y) => same(x, y)))
    for (const a of added) if (!out.some((y) => same(a, y))) out.push(a)
    return out
  }
  // Objets (connecteurs MCP) : clé par clé
  if (isObj(fresh) && isObj(prev) && isObj(next)) {
    const out: Record<string, unknown> = { ...fresh }
    for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (!(k in next)) { if (k in prev) delete out[k]; continue }
      if (!(k in prev)) { out[k] = next[k]; continue }
      if (!same(prev[k], next[k])) out[k] = k in fresh ? merge3(fresh[k], prev[k], next[k]) : next[k]
    }
    return out
  }
  return next
}
