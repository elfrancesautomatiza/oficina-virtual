import React from 'react'
import { jobOf, type AgentAlerts, type AgentConfig, type Meeting, type OfficeMeta } from '@shared/types'
import { Avatar } from './Avatar'

interface Props {
  agents: AgentConfig[]
  alerts: Record<string, AgentAlerts>
  busy: (slug: string) => string | undefined
  selected: string | null
  onSelect: (slug: string) => void
  onNew: () => void
  meeting?: Meeting
  onOpenMeeting: () => void
  offices: OfficeMeta[]
  current: string
  officeTotals: Record<string, number>
  onSwitch: (slug: string) => void
  onNewOffice: () => void
}

export function Office({ agents, alerts, busy, selected, onSelect, onNew, meeting, onOpenMeeting, offices, current, officeTotals, onSwitch, onNewOffice }: Props): React.JSX.Element {
  const sorted = [...agents].sort((a, b) => a.desk.row - b.desk.row || a.desk.col - b.desk.col)
  const others = offices.filter((o) => o.slug !== current)
  return (
    <main className="office">
      <div className="office-grid">
        {sorted.map((a) => {
          const al = alerts[a.slug]
          const b = busy(a.slug)
          return (
            <div
              key={a.slug}
              className={`desk ${b ? 'busy' : ''} ${selected === a.slug ? 'selected' : ''}`}
              style={{ ['--c' as string]: a.color }}
              onClick={() => onSelect(a.slug)}
              title={a.tagline}
            >
              {al && al.total > 0 && (
                <div className={`pastille ${al.inboxQuestions || al.pendingQuestion ? 'q' : ''}`} title={alertTitle(al)}>{al.total}</div>
              )}
              {b && <div className="bubble">{b}</div>}
              <div className="avatar"><Avatar spec={a.avatar} size={84} /></div>
              <div className="screen" />
              <div className="table" />
              <div className="plate"><div className="n">{a.name}</div><div className="r">{jobOf(a)}</div></div>
            </div>
          )
        })}
        <div className="desk new" onClick={onNew}>
          <div style={{ fontSize: 32, lineHeight: 1 }}>+</div>
          <div style={{ marginTop: 8 }}>Agente</div>
        </div>
      </div>

      <div className="meeting-room" onClick={meeting ? onOpenMeeting : undefined} style={{ cursor: meeting ? 'pointer' : 'default' }}>
        <div style={{ fontSize: 26 }}>▦</div>
        <div style={{ flex: 1 }}>
          <h3>Sala de reuniones</h3>
          <p>{meeting ? `En curso: ${meeting.topic} (${meeting.turns.length} intervenciones)` : 'Libre. Lanza una reunión para que los agentes conversen entre ellos.'}</p>
        </div>
        {meeting && <span className="dot busy" />}
      </div>

      {/* Les portes vers les autres bureaux */}
      <div className="doors">
        {others.map((o) => (
          <div key={o.slug} className="door" style={{ ['--c' as string]: o.color }} onClick={() => onSwitch(o.slug)} title={`Ir a la oficina ${o.name}`}>
            <div className="door-frame"><div className="door-leaf"><span className="knob" /></div></div>
            <div className="door-plate">{o.name}{(officeTotals[o.slug] ?? 0) > 0 && <span className="badge">{officeTotals[o.slug]}</span>}</div>
          </div>
        ))}
        <div className="door new" onClick={onNewOffice} title="Abrir una nueva oficina para otra empresa">
          <div className="door-frame"><div className="door-leaf dashed">+</div></div>
          <div className="door-plate">Nueva oficina</div>
        </div>
      </div>
    </main>
  )
}

function alertTitle(a: AgentAlerts): string {
  const parts: string[] = []
  if (a.pendingQuestion) parts.push('tienes una pregunta pendiente en la conversación')
  if (a.inboxQuestions) parts.push(`${a.inboxQuestions} pregunta(s) en la bandeja de entrada`)
  if (a.inboxInfos) parts.push(`${a.inboxInfos} aviso(s)`)
  if (a.unreadReports) parts.push(`${a.unreadReports} informe(s) sin leer`)
  return parts.join(' · ')
}
