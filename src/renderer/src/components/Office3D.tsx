import React, { useEffect, useRef, useState } from 'react'
import type { AgentAlerts, OfficeMeta } from '@shared/types'
import { World, DECOS, type AgentState, type OfficeData } from '../three/world'

interface Props {
  offices: OfficeMeta[]
  /** clé `${office}/${slug}` → texte d'activité */
  busy: Record<string, string | undefined>
  meeting: { office: string; participants: string[] } | null
  /** change à chaque rafraîchissement de l'app (nouveaux agents, alertes…) */
  version: number
  onAgentClick: (office: string, slug: string) => void
  onOfficeFocus: (office: string) => void
  onNewOffice: () => void
  onArchiveOffice: (office: string) => void
}

export function Office3D({ offices, busy, meeting, version, onAgentClick, onOfficeFocus, onNewOffice, onArchiveOffice }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<World | null>(null)
  const cbRef = useRef({ onAgentClick, onOfficeFocus })
  cbRef.current = { onAgentClick, onOfficeFocus }
  const [view, setView] = useState<string>('campus')
  const [edit, setEdit] = useState(false)
  const [placing, setPlacing] = useState<string | null>(null)
  const [size, setSize] = useState<{ w: number; d: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<Record<string, Record<string, AgentAlerts>>>({})
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Création du monde 3D
  useEffect(() => {
    if (!canvasRef.current || !tagsRef.current) return
    let w: World
    try {
      w = new World(canvasRef.current, tagsRef.current, {
        onAgentClick: (o, s) => cbRef.current.onAgentClick(o, s),
        onOfficeFocus: (o) => { setView(o ?? 'campus'); if (o) { cbRef.current.onOfficeFocus(o); setSize(w.sizeOf(o)) } else setSize(null) },
        onLayoutChange: (o, l) => { window.api.saveLayout(o, l).catch(() => setToast('Distribución no guardada')); if (o === w.view) setSize({ w: l.w, d: l.d }) },
        onToast: (m) => setToast(m),
        onSelect: (l) => setSelected(l),
        onPlaced: () => setPlacing(null)
      })
    } catch (e) { setError((e as Error).message); return }
    worldRef.current = w
    return () => { w.dispose(); worldRef.current = null }
  }, [])

  // Données : tous les bureaux, leurs agents, leur disposition et leurs alertes
  useEffect(() => {
    let alive = true
    ;(async () => {
      const list: OfficeData[] = []
      const al: Record<string, Record<string, AgentAlerts>> = {}
      for (const m of offices) {
        const [st, layout, a] = await Promise.all([window.api.getOffice(m.slug), window.api.getLayout(m.slug), window.api.getAlerts(m.slug)])
        list.push({ slug: m.slug, name: st.companyName || m.name, color: st.color || m.color, agents: st.agents, layout })
        al[m.slug] = a
      }
      if (!alive || !worldRef.current) return
      worldRef.current.setOffices(list)
      setAlerts(al)
      setReady(true)
    })().catch((e) => setError((e as Error).message))
    return () => { alive = false }
  }, [offices, version])

  // États : travaille / question / rapport / en attente
  useEffect(() => {
    const w = worldRef.current; if (!w || !ready) return
    const states: Record<string, { state: AgentState; busyText?: string }> = {}
    for (const [o, byAgent] of Object.entries(alerts)) {
      for (const [slug, a] of Object.entries(byAgent)) {
        const k = `${o}/${slug}`
        states[k] = { state: a.inboxQuestions > 0 || a.pendingQuestion ? 'question' : a.unreadReports > 0 || a.inboxInfos > 0 ? 'report' : 'idle' }
      }
    }
    for (const [k, t] of Object.entries(busy)) if (t) states[k] = { state: 'work', busyText: t.length > 28 ? t.slice(0, 27) + '…' : t }
    w.setStates(states)
  }, [alerts, busy, ready])

  useEffect(() => { if (ready) worldRef.current?.setMeeting(meeting?.office ?? null, meeting?.participants ?? []) }, [meeting?.office, meeting?.participants.join(), ready])
  useEffect(() => { const w = worldRef.current; if (w) { w.editMode = edit; if (!edit) { w.placing = null; setPlacing(null); w.clearSelection() } } }, [edit])
  useEffect(() => { const w = worldRef.current; if (w) w.placing = placing }, [placing])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t) }, [toast])

  // Raccourcis en mode aménagement
  useEffect(() => {
    if (!edit) return
    const k = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'r' || e.key === 'R') worldRef.current?.rotateSelected()
      if (e.key === 'Delete' || e.key === 'Backspace') worldRef.current?.deleteSelected()
      if (e.key === 'Escape') setPlacing(null)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [edit])

  const go = (v: string): void => {
    const w = worldRef.current; if (!w) return
    if (v === 'campus') w.focusCampus(); else w.focusOffice(v)
  }

  if (error) return <div className="office w3-error"><p>La vista 3D no se puede mostrar en este computador ({error}).</p><p className="hint">Vuelve a la vista 2D con el botón de arriba.</p></div>

  return (
    <div className="w3">
      <canvas ref={canvasRef} className="w3-canvas" />
      <div ref={tagsRef} className="w3-tags" />
      <div className="w3-bar">
        <div className="w3-chips">
          <button className={view === 'campus' ? 'on' : ''} onClick={() => go('campus')}>Todas las salas</button>
          {offices.map((o) => <button key={o.slug} className={view === o.slug ? 'on' : ''} onClick={() => go(o.slug)}><span className="w3-dot" style={{ background: o.color }} />{o.name}</button>)}
          <button title="Nueva oficina" onClick={onNewOffice}>+</button>
        </div>
        <span className="spacer" />
        <div className="w3-chips">
          <button title="Alejar" onClick={() => worldRef.current?.zoomBy(1 / 1.25)}>−</button>
          <button title="Acercar" onClick={() => worldRef.current?.zoomBy(1.25)}>+</button>
          <button title="Reencuadrar" onClick={() => worldRef.current?.refit()}>Ver todo</button>
          <button className={edit ? 'on' : ''} onClick={() => setEdit((x) => !x)}>{edit ? 'Terminar' : 'Decorar'}</button>
        </div>
      </div>
      {edit && (
        <div className="w3-palette">
          {selected ? (
            <div className="w3-sel">
              <b>{selected}</b>
              <button onClick={() => worldRef.current?.rotateSelected()}>Girar ↻</button>
              <button className="danger" onClick={() => worldRef.current?.deleteSelected()}>Eliminar</button>
              <button onClick={() => worldRef.current?.clearSelection()}>✕</button>
            </div>
          ) : (
            <div className="hint">Haz clic en un objeto (planta, sofá, pizarra…) para seleccionarlo y luego Eliminar o Girar. Arrastra un agente o un objeto para moverlo. Para agregar: elige un objeto abajo y haz clic en el suelo.</div>
          )}
          <div className="w3-chips wrap">
            {DECOS.map((d) => <button key={d.id} className={placing === d.id ? 'on' : ''} onClick={() => setPlacing((p) => (p === d.id ? null : d.id))}>{d.label}</button>)}
          </div>
          {view !== 'campus' ? (
            <div className="w3-chips">
              <button onClick={() => worldRef.current?.resizeOffice(2, 0)}>Agrandar ↔</button>
              <button onClick={() => worldRef.current?.resizeOffice(0, 2)}>Agrandar ↕</button>
              <button onClick={() => worldRef.current?.resizeOffice(-2, -2)}>Reducir</button>
              {size && <span className="hint">{size.w} × {size.d} casillas</span>}
              <button className="danger" onClick={() => onArchiveOffice(view)}>Quitar esta oficina</button>
            </div>
          ) : <div className="hint">Entra en una oficina para agrandarla o reducirla.</div>}
        </div>
      )}
      {!ready && <div className="w3-loading">Cargando la oficina…</div>}
      {toast && <div className="w3-toast">{toast}</div>}
    </div>
  )
}
