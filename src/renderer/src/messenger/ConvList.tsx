// Liste des conversations, dans la barre latérale.
import React, { useMemo, useState } from 'react'
import type { ConversationSummary } from '@shared/types'
import { avatarSvg } from '@shared/avatar'

export type ConvFilter = 'tous' | 'non-lus' | string // string = slug d'un bureau

export function heure(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso); const now = new Date()
  if (isNaN(d.getTime())) return ''
  const jour = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((jour(now) - jour(d)) / 86_400_000)
  if (diff === 0) return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  if (diff === 1) return 'Ayer'
  if (diff < 7) return d.toLocaleDateString('es-CL', { weekday: 'long' })
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export const estNonLu = (c: ConversationSummary): boolean => c.unread > 0 || c.manualUnread

export function ConvList(props: {
  conversations: ConversationSummary[]
  selected?: string | null
  busy?: Record<string, string | undefined>
  onOpen: (c: ConversationSummary) => void
  onToggleUnread: (c: ConversationSummary) => void
  header?: React.ReactNode
}): React.JSX.Element {
  const [filter, setFilter] = useState<ConvFilter>(() => { try { return localStorage.getItem('conv-filter') || 'tous' } catch { return 'tous' } })
  const [q, setQ] = useState('')
  const choisir = (f: ConvFilter): void => { setFilter(f); try { localStorage.setItem('conv-filter', f) } catch { /* */ } }
  const bureaux = useMemo(() => {
    const m = new Map<string, { slug: string; name: string; color: string; n: number }>()
    // Tous les bureaux, y compris ceux masqués de la vue 3D : la messagerie montre tout.
    for (const c of props.conversations) {
      const b = m.get(c.office) ?? { slug: c.office, name: c.officeName, color: c.officeColor, n: 0 }
      if (estNonLu(c)) b.n += 1
      m.set(c.office, b)
    }
    return [...m.values()]
  }, [props.conversations])
  const nonLus = props.conversations.filter(estNonLu).length
  const visibles = props.conversations.filter((c) => {
    if (q.trim() && !`${c.name} ${c.role} ${c.officeName} ${c.preview}`.toLowerCase().includes(q.trim().toLowerCase())) return false
    if (c.pinned) return true
    if (filter === 'non-lus') return estNonLu(c)
    if (filter !== 'tous' && bureaux.some((b) => b.slug === filter)) return c.office === filter // bureau disparu : on montre tout
    return true
  })
  return (
    <div className="conv">
      {props.header}
      <div className="conv-search"><input placeholder="Buscar un agente, un mensaje…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="conv-chips">
        <button className={filter === 'tous' ? 'on' : ''} onClick={() => choisir('tous')}>Todos</button>
        <button className={filter === 'non-lus' ? 'on' : ''} onClick={() => choisir('non-lus')}>No leídos{nonLus > 0 && <b>{nonLus}</b>}</button>
        {bureaux.map((b) => (
          <button key={b.slug} className={filter === b.slug ? 'on' : ''} onClick={() => choisir(b.slug)} style={{ ['--c' as string]: b.color }}>
            <i className="pt" />{b.name}{b.n > 0 && <b>{b.n}</b>}
          </button>
        ))}
      </div>
      <div className="conv-list">
        {visibles.map((c) => {
          const id = `${c.office}/${c.slug}`
          const occupe = props.busy?.[id]
          const nl = estNonLu(c)
          return (
            <div key={id} className={`conv-row ${props.selected === id ? 'sel' : ''} ${nl ? 'nl' : ''} ${c.pinned ? 'pin' : ''}`} onClick={() => props.onOpen(c)}
              onContextMenu={(e) => { e.preventDefault(); props.onToggleUnread(c) }}>
              <span className="conv-av" style={{ ['--c' as string]: c.color }} dangerouslySetInnerHTML={{ __html: avatarSvg(c.avatar, 48) }} />
              <div className="conv-mid">
                <div className="conv-l1">
                  <span className="conv-name">{c.name}</span>
                  {!c.officeHidden && <span className="conv-office" style={{ ['--c' as string]: c.officeColor }}>{c.officeName}</span>}
                  <span className="conv-time">{heure(c.lastAt)}</span>
                </div>
                <div className="conv-l2">
                  <span className="conv-prev">
                    {occupe ? <em className="typing">{occupe}</em> : <>
                      {c.previewFrom === 'moi' && <span className="from">Tú: </span>}
                      {c.previewFrom === 'question' && <span className="tag q">Pregunta</span>}
                      {c.previewFrom === 'info' && <span className="tag i">Info</span>}
                      {c.previewFrom === 'rapport' && <span className="tag r">Informe</span>}
                      {c.preview || c.role}
                    </>}
                  </span>
                  {c.pinned && <span className="conv-pin" title="Fijado">📌</span>}
                  {c.unread > 0 ? <span className={`conv-badge ${c.question ? 'q' : ''}`}>{c.unread}</span> : c.manualUnread ? <span className="conv-badge dotonly" /> : null}
                  <button className="conv-mark" title={nl ? 'Marcar como leído' : 'Marcar como no leído'} onClick={(e) => { e.stopPropagation(); props.onToggleUnread(c) }}>{nl ? '✓' : '●'}</button>
                </div>
              </div>
            </div>
          )
        })}
        {visibles.length === 0 && <div className="conv-empty">{filter === 'non-lus' ? 'Todo leído.' : 'Ninguna conversación.'}</div>}
      </div>
    </div>
  )
}
