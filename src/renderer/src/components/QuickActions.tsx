import React, { useEffect, useState } from 'react'
import type { QuickAction } from '@shared/types'

interface Props { office: string; slug: string; name: string; busy: boolean; onSend: (text: string) => void }

const fill = (t: string, v: Record<string, string>): string => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '…')

/** Boutons rapides d'un agent : un bouton → des sous-boutons (étapes) → message prêt à envoyer. */
export function QuickActions({ office, slug, name, busy, onSend }: Props): React.JSX.Element | null {
  const [list, setList] = useState<QuickAction[]>([])
  const [open, setOpen] = useState(true)
  const [act, setAct] = useState<QuickAction | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [free, setFree] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = (): void => { window.api.getActions(office, slug).then(setList).catch(() => setList([])) }
  useEffect(load, [office, slug])

  const start = (a: QuickAction): void => {
    if (a.steps.length === 0) { onSend(a.template); return }
    setAct(a); setVals({}); setFree({})
  }
  const done = act ? act.steps.every((s) => (vals[s.key] ?? '').trim()) : false
  const message = act ? fill(act.template, vals) : ''

  const saveJson = async (): Promise<void> => {
    try {
      const parsed = JSON.parse(editing ?? '') as QuickAction[]
      await window.api.saveActions(office, slug, parsed)
      setEditing(null); setErr(null); load()
    } catch (e) { setErr((e as Error).message) }
  }

  if (editing !== null) {
    return (
      <div className="qa">
        <div className="qa-head"><b>Editar los botones de {name}</b><button onClick={() => { setEditing(null); setErr(null) }}>Cancelar</button></div>
        <div className="hint">Formato JSON. También puedes pedirle a {name} en la conversación: «agrega un botón para…».</div>
        <textarea className="qa-json" value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck={false} />
        {err && <div className="hint" style={{ color: 'var(--err)' }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}><button className="primary" onClick={saveJson}>Guardar</button></div>
      </div>
    )
  }

  if (!list.length) return null

  if (act) {
    return (
      <div className="qa">
        <div className="qa-head"><b>{act.label}</b><button onClick={() => setAct(null)}>✕</button></div>
        {act.steps.map((s) => (
          <div key={s.key} className="qa-step">
            <label>{s.label}</label>
            <div className="qa-chips">
              {s.options.map((o) => <button key={o} className={vals[s.key] === o ? 'on' : ''} onClick={() => { setVals((v) => ({ ...v, [s.key]: o })); setFree((f) => ({ ...f, [s.key]: '' })) }}>{o}</button>)}
            </div>
            {(s.free || s.options.length === 0) && (
              <input value={free[s.key] ?? ''} placeholder={s.free ?? 'Escribe aquí…'} onChange={(e) => { const t = e.target.value; setFree((f) => ({ ...f, [s.key]: t })); setVals((v) => ({ ...v, [s.key]: t })) }} />
            )}
          </div>
        ))}
        <div className="qa-preview">{message}</div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <button onClick={() => setAct(null)}>Cancelar</button>
          <button className="primary" disabled={!done || busy} onClick={() => { onSend(message); setAct(null) }}>Enviar a {name.split(' ')[0]}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="qa">
      <div className="qa-head">
        <button className="qa-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Acciones rápidas</button>
        {open && <button className="qa-edit" title="Editar los botones" onClick={() => setEditing(JSON.stringify(list, null, 2))}>Editar</button>}
      </div>
      {open && (
        <div className="qa-grid">
          {list.map((a) => (
            <button key={a.id} disabled={busy} onClick={() => start(a)} title={a.hint}>
              <b>{a.label}</b>{a.hint && <span>{a.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
