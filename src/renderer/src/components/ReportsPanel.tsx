import React from 'react'
import { useState } from 'react'
import type { AgentConfig, Report } from '@shared/types'

export function ReportsPanel({ office, reports, agents, onClose, onChanged }: { office: string; reports: Report[]; agents: AgentConfig[]; onClose: () => void; onChanged: () => void }): React.JSX.Element {
  const [open, setOpen] = useState<Report | null>(null)
  const [content, setContent] = useState('')
  const name = (slug: string): string => agents.find((a) => a.slug === slug)?.name ?? slug

  const show = async (r: Report): Promise<void> => {
    setOpen(r)
    setContent(await window.api.readReport(office, r.agentSlug, r.file))
    if (!r.read) { await window.api.markReportRead(office, r.agentSlug, r.file); onChanged() }
  }

  return (
    <aside className="side">
      <div className="side-head"><div className="t"><b>Informes</b><span>{reports.filter((r) => !r.read).length} sin leer. Solo uno sin leer por agente: los anteriores se resumen.</span></div><button onClick={onClose}>✕</button></div>
      <div className="side-body">
        {open ? (
          <>
            <button onClick={() => setOpen(null)} style={{ marginBottom: 10 }}>← Todos los informes</button>
            <div className="hint">{name(open.agentSlug)} · {open.date}{open.condensedFrom ? ` · resume ${open.condensedFrom} informe(s) sin leer` : ''}</div>
            <div className="md" style={{ marginTop: 8 }}>{content}</div>
          </>
        ) : (
          <div className="list">
            {reports.length === 0 && <div className="empty">Ningún informe. Aparecen cuando corre una rutina (o con «Lanzar ahora» en los ajustes de un agente).</div>}
            {reports.map((r) => (
              <div key={r.agentSlug + r.file} className={`item ${r.read ? '' : 'unread'}`} style={{ cursor: 'pointer' }} onClick={() => show(r)}>
                <h4>{r.title}</h4>
                <div className="m">{name(r.agentSlug)} · {r.date}{r.condensedFrom ? ` · resumido (${r.condensedFrom})` : ''}{r.read ? '' : ' · no leído'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
