import React from 'react'
import { useState } from 'react'
import type { AgentConfig } from '@shared/types'
import { Avatar } from './Avatar'

export function MeetingModal({ office, agents, onClose, onStarted }: { office: string; agents: AgentConfig[]; onClose: () => void; onStarted: (id: string) => void }): React.JSX.Element {
  const [topic, setTopic] = useState('')
  const [sel, setSel] = useState<string[]>(agents.map((a) => a.slug))
  const [busy, setBusy] = useState(false)
  const toggle = (s: string): void => setSel((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))

  const start = async (): Promise<void> => {
    if (!topic.trim() || sel.length < 2) return
    setBusy(true)
    try { onStarted(await window.api.startMeeting(office, topic.trim(), sel)) } catch (e) { alert((e as Error).message); setBusy(false) }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reunión de equipo</h2>
        <div className="sub">Dos rondas: cada uno cuenta lo que sabe y pide lo que le falta, luego responde a los demás y se compromete. Después, cada agente anota lo que aprendió en su propia memoria. Calcula unas 2 llamadas por participante.</div>
        <label>Tema</label>
        <input value={topic} autoFocus placeholder="ej. ¿Cómo conseguimos 3 clientes nuevos este mes?" onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} />
        <label>Participantes ({sel.length})</label>
        <div className="participants">
          {agents.map((a) => (
            <div key={a.slug} className={`participant ${sel.includes(a.slug) ? 'on' : ''}`} onClick={() => toggle(a.slug)}>
              <Avatar spec={a.avatar} size={30} />
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.name}</div><div className="hint" style={{ margin: 0 }}>{a.role}</div></div>
            </div>
          ))}
        </div>
        <div className="actions">
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy || !topic.trim() || sel.length < 2} onClick={start}>Convocar</button>
        </div>
      </div>
    </div>
  )
}
