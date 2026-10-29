import React, { useState } from 'react'
import type { OfficeMeta } from '@shared/types'

const COLORS = ['#5b8cff', '#e0534f', '#2a9d8f', '#6a4c93', '#f4a261', '#ff7b9c', '#06d6a0', '#b5179e']

export function NewOfficeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (m: OfficeMeta) => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [color, setColor] = useState(COLORS[1])
  const [busy, setBusy] = useState(false)
  const create = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    try { onCreated(await window.api.createOffice(name.trim(), owner.trim(), color)) } finally { setBusy(false) }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <h2>Nueva oficina</h2>
        <div className="sub">Otra empresa, otro equipo. Agentes, memorias, informes y reuniones totalmente separados. Una puerta une las oficinas.</div>
        <label>Nombre de la empresa</label>
        <input value={name} autoFocus placeholder="ej. Mi segunda empresa" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <label>Jefe (cómo te llaman los agentes)</label>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} />
        <label>Color de la oficina</label>
        <div className="row wrap">
          {COLORS.map((c) => <span key={c} onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', outline: color === c ? '3px solid #fff' : 'none', outlineOffset: 2 }} />)}
        </div>
        <div className="actions">
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy || !name.trim()} onClick={create}>Abrir la oficina</button>
        </div>
      </div>
    </div>
  )
}
