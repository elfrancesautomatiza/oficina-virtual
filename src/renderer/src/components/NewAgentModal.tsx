import React from 'react'
import { useMemo, useState } from 'react'
import type { AgentConfig, NewAgentInput } from '@shared/types'
import { makeAvatar } from '@shared/avatar'
import { Avatar } from './Avatar'

export function NewAgentModal({ office, onClose, onCreated }: { office: string; onClose: () => void; onCreated: (a: AgentConfig) => void }): React.JSX.Element {
  const [f, setF] = useState<NewAgentInput>({ name: '', role: '', tagline: '', mission: '', folders: [], gender: 'f', allowWeb: true, allowBash: false })
  const [seedBump, setSeedBump] = useState(0)
  const [saving, setSaving] = useState(false)
  const preview = useMemo(() => makeAvatar(`${f.name}${f.role}${seedBump}`, f.gender), [f.name, f.role, f.gender, seedBump])
  const set = <K extends keyof NewAgentInput>(k: K, v: NewAgentInput[K]): void => setF({ ...f, [k]: v })

  const create = async (): Promise<void> => {
    if (!f.name.trim() || !f.role.trim() || !f.mission.trim()) return
    setSaving(true)
    try { onCreated(await window.api.createAgent(office, f)) } finally { setSaving(false) }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Nuevo agente</h2>
        <div className="sub">Un nuevo agente = una carpeta, una conversación Claude aislada, una memoria propia, sus propias carpetas.</div>
        <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
          <div style={{ textAlign: 'center' }}>
            <Avatar spec={preview} size={110} />
            <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
              <button style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => set('gender', f.gender === 'f' ? 'm' : 'f')}>{f.gender === 'f' ? 'Mujer' : 'Hombre'}</button>
              <button style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setSeedBump((s) => s + 1)}>Otra cara</button>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <label>Nombre (personificado, ej. «Sofía Ventas»)</label>
            <input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
            <label>Cargo</label>
            <input value={f.role} placeholder="ej. Responsable de ventas" onChange={(e) => set('role', e.target.value)} />
            <label>Frase gancho</label>
            <input value={f.tagline} placeholder="ej. Cada contacto recibe una respuesta en menos de una hora." onChange={(e) => set('tagline', e.target.value)} />
          </div>
        </div>
        <label>Misión detallada (qué hace, para quién, qué nunca debe hacer)</label>
        <textarea value={f.mission} style={{ minHeight: 120 }} onChange={(e) => set('mission', e.target.value)} />
        <label>Carpetas accesibles</label>
        <div className="list">
          {f.folders.map((p) => <div key={p} className="row item" style={{ justifyContent: 'space-between' }}><code>{p}</code><span className="chip x" onClick={() => set('folders', f.folders.filter((x) => x !== p))}>quitar</span></div>)}
          <button onClick={async () => { const p = await window.api.pickFolder(); if (p && !f.folders.includes(p)) set('folders', [...f.folders, p]) }}>+ Carpeta</button>
        </div>
        <label className="check"><input type="checkbox" checked={f.allowWeb} onChange={(e) => set('allowWeb', e.target.checked)} /> Acceso web (búsqueda y lectura de páginas)</label>
        <label className="check"><input type="checkbox" checked={f.allowBash} onChange={(e) => set('allowBash', e.target.checked)} /> Terminal (Bash) — solo para agentes técnicos</label>
        <div className="actions">
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={saving || !f.name.trim() || !f.role.trim() || !f.mission.trim()} onClick={create}>Crear agente</button>
        </div>
      </div>
    </div>
  )
}
