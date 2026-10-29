import React from 'react'
import { useEffect, useState } from 'react'
import type { AgentConfig, Meeting } from '@shared/types'

export function MeetingsPanel({ meetings, agents, initialId, onClose }: { meetings: Meeting[]; agents: AgentConfig[]; initialId?: string; onClose: () => void }): React.JSX.Element {
  const [id, setId] = useState<string | undefined>(initialId ?? meetings[0]?.id)
  useEffect(() => { if (initialId) setId(initialId) }, [initialId])
  const m = meetings.find((x) => x.id === id)
  const color = (slug: string): string => agents.find((a) => a.slug === slug)?.color ?? 'var(--line)'

  return (
    <aside className="side">
      <div className="side-head"><div className="t"><b>Reuniones</b><span>{meetings.length} en total</span></div><button onClick={onClose}>✕</button></div>
      <div className="side-body">
        {!m && <div className="empty">Ninguna reunión. Usa el botón «Reunión de equipo».</div>}
        {m && (
          <>
            {meetings.length > 1 && (
              <select value={m.id} onChange={(e) => setId(e.target.value)} style={{ marginBottom: 10 }}>
                {meetings.map((x) => <option key={x.id} value={x.id}>{x.startedAt.slice(0, 16).replace('T', ' ')} — {x.topic}</option>)}
              </select>
            )}
            <h4 style={{ margin: '4px 0' }}>{m.topic}</h4>
            <div className="hint">{m.status === 'running' ? 'En curso…' : m.status === 'done' ? 'Terminada' : 'Error'} · {m.participants.length} participantes · {m.turns.length} intervenciones</div>
            {m.summary && <div className="item" style={{ margin: '10px 0', borderColor: 'var(--accent)' }}><h4>Síntesis</h4><div className="md">{m.summary}</div></div>}
            {[1, 2].map((round) => {
              const turns = m.turns.filter((t) => t.round === round)
              if (!turns.length) return null
              return (
                <div key={round}>
                  <h4 style={{ margin: '14px 0 4px', color: 'var(--muted)' }}>Ronda {round}{round === 1 ? ' — situación y pedidos' : ' — respuestas y compromisos'}</h4>
                  {turns.map((t, i) => <div key={i} className="turn" style={{ ['--c' as string]: color(t.agentSlug) }}><b>{t.agentName}</b><p>{t.text}</p></div>)}
                </div>
              )
            })}
            {m.status === 'running' && <div className="msg system" style={{ marginTop: 10 }}>Los agentes hablan… (cada ronda corre en paralelo)</div>}
          </>
        )}
      </div>
    </aside>
  )
}
