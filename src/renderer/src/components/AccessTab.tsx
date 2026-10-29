import React, { useEffect, useState } from 'react'
import type { AccessEntry } from '@shared/types'

type Row = AccessEntry & { ready: boolean }
interface Props { office: string; slug: string; name: string; onCount?: (missing: number) => void }
interface Form { id?: string; name: string; kind: 'api' | 'login'; url: string; user: string; secret: string; note?: string }

const empty: Form = { name: '', kind: 'api', url: '', user: '', secret: '' }

/** Onglet Accès : clés API et identifiants de l'agent. Les secrets vont dans le Trousseau macOS. */
export function AccessTab({ office, slug, name, onCount }: Props): React.JSX.Element {
  const [rows, setRows] = useState<Row[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const first = name.split(' ')[0]

  const load = (): void => { window.api.listAccess(office, slug).then((r) => { setRows(r); onCount?.(r.filter((x) => !x.ready).length) }).catch(() => setRows([])) }
  useEffect(load, [office, slug])

  const edit = (r?: Row): void => { setErr(null); setForm(r ? { id: r.id, name: r.name, kind: r.kind, url: r.url ?? '', user: r.user ?? '', secret: '', note: r.note } : { ...empty }) }

  const save = async (): Promise<void> => {
    if (!form) return
    if (!form.name.trim()) { setErr('Ponle un nombre'); return }
    const existing = form.id ? rows.find((r) => r.id === form.id) : undefined
    if (!form.secret.trim() && !existing?.ready) { setErr(form.kind === 'api' ? 'Pega la clave' : 'Escribe la contraseña'); return }
    setBusy(true)
    try {
      await window.api.saveAccess(office, slug, { id: form.id, name: form.name.trim(), kind: form.kind, url: form.url.trim() || undefined, user: form.kind === 'login' ? form.user.trim() || undefined : undefined, note: form.note }, form.secret)
      setForm(null); load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const remove = async (r: Row): Promise<void> => {
    if (!confirm(`¿Quitar «${r.name}»? La clave se borra del Llavero y ${first} ya no tendrá acceso.`)) return
    await window.api.removeAccess(office, slug, r.id); load()
  }

  if (form) {
    const existing = form.id ? rows.find((r) => r.id === form.id) : undefined
    return (
      <div className="access-form">
        <h4 style={{ margin: '2px 0 8px' }}>{form.id ? `${existing?.ready ? 'Reemplazar' : 'Completar'} «${form.name}»` : 'Nuevo acceso'}</h4>
        {form.note && <div className="notice">{first}: {form.note}</div>}
        <div className="qa-chips">
          <button className={form.kind === 'api' ? 'on' : ''} onClick={() => setForm({ ...form, kind: 'api' })}>{'Clave API'}</button>
          <button className={form.kind === 'login' ? 'on' : ''} onClick={() => setForm({ ...form, kind: 'login' })}>{'Usuario (email + contraseña)'}</button>
        </div>
        <label>{'Nombre'}</label>
        <input value={form.name} placeholder="ej. DataForSEO, Metricool…" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>{form.kind === 'api' ? 'Enlace (opcional: dónde obtener o gestionar la clave)' : 'Enlace de la página de inicio de sesión'}</label>
        <input value={form.url} placeholder="https://…" onChange={(e) => setForm({ ...form, url: e.target.value })} />
        {form.kind === 'login' && <><label>{'Email / usuario'}</label><input value={form.user} autoComplete="off" onChange={(e) => setForm({ ...form, user: e.target.value })} /></>}
        <label>{form.kind === 'api' ? 'Clave API' : 'Contraseña'}{existing?.ready ? ' (déjalo vacío para mantener la actual)' : ''}</label>
        <input type="password" value={form.secret} autoComplete="new-password" spellCheck={false} onChange={(e) => setForm({ ...form, secret: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <div className="hint">Se guarda en el Llavero de tu Mac, nunca en un archivo ni en la conversación. {first} lo recibe solo al momento de trabajar.</div>
        {err && <div className="hint" style={{ color: 'var(--err)' }}>{err}</div>}
        <div className="actions" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <button onClick={() => setForm(null)}>{'Cancelar'}</button>
          <button className="primary" disabled={busy} onClick={save}>{'Guardar'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="list">
      <div className="hint">Claves API y usuarios de {first}. Puede crear una línea «por completar» cuando le falta un acceso: solo tienes que pegar la clave.</div>
      {rows.length === 0 && <div className="empty">{'Ningún acceso por ahora.'}</div>}
      {rows.map((r) => (
        <div key={r.id} className={`item access-row ${r.ready ? '' : 'unread'}`}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <h4 style={{ margin: 0 }}>{r.name} <span className="hint">· {r.kind === 'api' ? 'clave API' : 'usuario'}</span></h4>
            <span className={`pill ${r.ready ? 'ok' : 'todo'}`}>{r.ready ? 'Lista' : 'Por completar'}</span>
          </div>
          {r.note && <div className="m">{r.requestedBy === 'agent' ? `Pedido por ${first}: ` : ''}{r.note}</div>}
          {r.kind === 'login' && r.user && <div className="m">{r.user}</div>}
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <button className={r.ready ? '' : 'primary'} onClick={() => edit(r)}>{r.ready ? 'Reemplazar' : 'Completar'}</button>
            {r.url && <button onClick={() => window.api.openUrl(r.url!)}>{r.kind === 'login' ? 'Iniciar sesión' : 'Abrir el enlace'}</button>}
            <button className="danger" onClick={() => remove(r)}>{'Quitar'}</button>
          </div>
        </div>
      ))}
      <button className="primary" style={{ marginTop: 8 }} onClick={() => edit()}>{'+ Agregar un acceso'}</button>
    </div>
  )
}
