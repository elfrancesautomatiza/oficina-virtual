import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentAlerts, AgentConfig, Meeting, OfficeMeta, OfficeState, Report, RunnerEvent } from '@shared/types'
import { Office } from './components/Office'
import { Office3D } from './components/Office3D'
import { AgentPanel } from './components/AgentPanel'
import { NewAgentModal } from './components/NewAgentModal'
import { NewOfficeModal } from './components/NewOfficeModal'
import { MeetingModal } from './components/MeetingModal'
import { ReportsPanel } from './components/ReportsPanel'
import { MeetingsPanel } from './components/MeetingsPanel'
import { MessengerSidebar } from './messenger/MessengerSidebar'

export type SideView = { kind: 'agent'; slug: string; office?: string } | { kind: 'reports' } | { kind: 'meetings'; id?: string } | null

export default function App(): React.JSX.Element {
  const [allOffices, setOffices] = useState<OfficeMeta[]>([])
  const offices = useMemo(() => allOffices.filter((o) => !o.hidden), [allOffices])
  const [extraAgent, setExtraAgent] = useState<AgentConfig | null>(null)
  const [unreadSince, setUnreadSince] = useState('')
  const [msgOpen, setMsgOpen] = useState<boolean>(() => { try { return localStorage.getItem('messagerie') !== '0' } catch { return true } })
  useEffect(() => { try { localStorage.setItem('messagerie', msgOpen ? '1' : '0') } catch { /* */ } }, [msgOpen])
  const [current, setCurrent] = useState<string | null>(() => { try { return localStorage.getItem('office') } catch { return null } })
  const [office, setOffice] = useState<OfficeState | null>(null)
  const [alerts, setAlerts] = useState<Record<string, AgentAlerts>>({})
  const [officeTotals, setOfficeTotals] = useState<Record<string, number>>({})
  const [side, setSide] = useState<SideView>(null)
  const [busy, setBusy] = useState<Record<string, string | undefined>>({})
  const [reports, setReports] = useState<Report[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [showNew, setShowNew] = useState(false)
  const [showNewOffice, setShowNewOffice] = useState(false)
  const [showMeeting, setShowMeeting] = useState(false)
  const [claude, setClaude] = useState<{ ok: boolean; version?: string; error?: string } | null>(null)
  const [slide, setSlide] = useState<'' | 'out' | 'in'>('')
  const [view3d, setView3d] = useState<boolean>(() => { try { return localStorage.getItem('view3d') !== '0' } catch { return true } })
  const [version, setVersion] = useState(0)
  useEffect(() => { try { localStorage.setItem('view3d', view3d ? '1' : '0') } catch { /* ignore */ } }, [view3d])

  const refreshAlerts = useCallback(async (o: string | null) => {
    setOfficeTotals(await window.api.getAllAlerts())
    if (o) setAlerts(await window.api.getAlerts(o))
  }, [])

  const refresh = useCallback(async () => {
    const all = await window.api.listOffices()
    setOffices(all)
    const list = all.filter((x) => !x.hidden)
    const o = current && list.some((x) => x.slug === current) ? current : list[0]?.slug ?? null
    if (o !== current) setCurrent(o)
    if (o) {
      setOffice(await window.api.getOffice(o))
      setReports(await window.api.listReports(o))
      setMeetings(await window.api.listMeetings(o))
    }
    await refreshAlerts(o)
    setVersion((v) => v + 1)
  }, [current, refreshAlerts])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { try { if (current) localStorage.setItem('office', current) } catch { /* ignore */ } }, [current])

  useEffect(() => {
    window.api.checkClaude().then(setClaude)
    const offRunner = window.api.onRunner((ev: RunnerEvent) => {
      const k = `${ev.office}/${ev.agentSlug}`
      if (ev.kind === 'start') setBusy((b) => ({ ...b, [k]: 'piensa…' }))
      else if (ev.kind === 'tool') setBusy((b) => ({ ...b, [k]: ev.text }))
      else if (ev.kind === 'end') setBusy((b) => ({ ...b, [k]: undefined }))
    })
    const offRoutine = window.api.onRoutine((ev) => {
      const k = `${ev.office}/${ev.slug}`
      if (ev.status === 'synced') { refresh(); return }
      setBusy((b) => ({ ...b, [k]: ev.status === 'running' ? 'rutina en curso' : undefined }))
      if (ev.status !== 'running') refresh()
    })
    const offMeeting = window.api.onMeeting(() => refresh())
    const offAlerts = window.api.onAlerts(() => { refreshAlerts(current); setVersion((v) => v + 1) })
    return () => { offRunner(); offRoutine(); offMeeting(); offAlerts() }
  }, [refresh, refreshAlerts, current])

  const switchOffice = (slug: string): void => {
    if (slug === current) return
    setSlide('out')
    setTimeout(() => { setSide(null); setCurrent(slug); setSlide('in'); setTimeout(() => setSlide(''), 350) }, 220)
  }

  const unread = useMemo(() => reports.filter((r) => !r.read).length, [reports])
  const totalAlerts = useMemo(() => Object.values(alerts).reduce((n, a) => n + a.total, 0), [alerts])
  const runningMeeting = meetings.find((m) => m.status === 'running')
  const busyFor = (slug: string): string | undefined => (current ? busy[`${current}/${slug}`] : undefined)

  if (!office || !current) {
    return (
      <div className="app">
        <header className="topbar"><span className="brand">{'Oficina virtual'}</span></header>
        <div className="empty">{offices.length === 0 ? <><p>{'Ninguna oficina.'}</p><button className="primary" onClick={() => setShowNewOffice(true)}>{'Crear la primera oficina'}</button></> : 'Cargando…'}</div>
        {showNewOffice && <NewOfficeModal onClose={() => setShowNewOffice(false)} onCreated={(m) => { setShowNewOffice(false); setCurrent(m.slug); refresh() }} />}
      </div>
    )
  }

  const openConversation = async (o: string, slug: string, hidden: boolean, seenAt = ''): Promise<void> => {
    setUnreadSince(seenAt || '')
    if (hidden || !offices.some((x) => x.slug === o)) {
      setExtraAgent(await window.api.getAgent(o, slug))
      setSide({ kind: 'agent', slug, office: o })
    } else {
      if (o !== current) { setSide(null); setCurrent(o) }
      setSide({ kind: 'agent', slug, office: o })
    }
  }
  const selectedConv = side?.kind === 'agent' ? `${side.office ?? current}/${side.slug}` : null

  return (
    <div className={`shell ${msgOpen ? '' : 'msg-closed'}`}>
    <MessengerSidebar open={msgOpen} onToggle={() => setMsgOpen((v) => !v)} selected={selectedConv} onOpen={openConversation} />
    <div className="app" style={{ ['--office' as string]: office.color }}>
      <header className="topbar">
        <span className="brand"><span className="office-dot" />{office.companyName}</span>
        <span className="status">
          <span className={`dot ${claude ? (claude.ok ? 'ok' : 'err') : ''}`} />
          {claude ? (claude.ok ? `Claude Code ${claude.version?.replace(/[^\d.]/g, '').slice(0, 12)}` : 'Claude Code no encontrado') : 'verificando…'}
        </span>
        {totalAlerts > 0 && <span className="status" title={'Preguntas, avisos e informes pendientes en esta oficina'}><span className="badge">{totalAlerts}</span> {'por revisar'}</span>}
        <span className="spacer" />
        <button title={'Cambiar de vista'} onClick={() => setView3d((v) => !v)}>{view3d ? 'Vista 2D' : 'Vista 3D'}</button>
        <button onClick={() => setSide({ kind: 'reports' })}>{'Informes'}{unread > 0 && <span className="badge">{unread}</span>}</button>
        <button onClick={() => setSide({ kind: 'meetings' })}>{'Reuniones'}{runningMeeting && <span className="dot busy" style={{ marginLeft: 6 }} />}</button>
        <button className="primary" onClick={() => setShowMeeting(true)} disabled={office.agents.length < 2}>{'Reunión de equipo'}</button>
        <button onClick={() => setShowNew(true)}>{'+ Agente'}</button>
      </header>

      <div className={`body ${side ? '' : 'wide'}`}>
        <div className={`office-wrap ${view3d ? '' : `slide-${slide}`}`}>
          {view3d ? (
            <Office3D
              offices={offices}
              busy={busy}
              meeting={runningMeeting ? { office: current, participants: runningMeeting.participants } : null}
              version={version}
              onAgentClick={(o, slug) => { if (o !== current) setCurrent(o); setSide({ kind: 'agent', slug }) }}
              onOfficeFocus={(o) => { if (o !== current) { setSide(null); setCurrent(o) } }}
              onNewOffice={() => setShowNewOffice(true)}
              onArchiveOffice={async (o) => {
                const m = offices.find((x) => x.slug === o)
                if (!m || !confirm(`¿Quitar la oficina «${m.name}»? Sus agentes y sus rutinas se detienen. No se borra nada: la carpeta se guarda en «archives» y se puede restaurar.`)) return
                try { await window.api.archiveOffice(o); setSide(null); setCurrent(offices.find((x) => x.slug !== o)?.slug ?? null); refresh() } catch (e) { alert((e as Error).message) }
              }}
            />
          ) : (
          <Office
            agents={office.agents}
            alerts={alerts}
            busy={busyFor}
            selected={side?.kind === 'agent' ? side.slug : null}
            onSelect={(slug) => setSide({ kind: 'agent', slug })}
            onNew={() => setShowNew(true)}
            meeting={runningMeeting}
            onOpenMeeting={() => setSide({ kind: 'meetings', id: runningMeeting?.id })}
            offices={offices}
            current={current}
            officeTotals={officeTotals}
            onSwitch={switchOffice}
            onNewOffice={() => setShowNewOffice(true)}
          />
          )}
        </div>
        {side?.kind === 'agent' && (!side.office || side.office === current) && office.agents.some((a) => a.slug === side.slug) && (
          <AgentPanel
            key={`${current}/${side.slug}`}
            office={current}
            agent={office.agents.find((a) => a.slug === side.slug) as AgentConfig}
            alerts={alerts[side.slug]}
            busy={!!busyFor(side.slug)}
            onClose={() => setSide(null)}
            onChanged={refresh}
            unreadSince={unreadSince}
          />
        )}
        {side?.kind === 'agent' && side.office && side.office !== current && extraAgent?.slug === side.slug && (
          <AgentPanel
            key={`${side.office}/${side.slug}`}
            office={side.office}
            agent={extraAgent}
            alerts={undefined}
            busy={!!busy[`${side.office}/${side.slug}`]}
            onClose={() => setSide(null)}
            onChanged={async () => { setExtraAgent(await window.api.getAgent(side.office as string, side.slug)); refresh() }}
            unreadSince={unreadSince}
          />
        )}
        {side?.kind === 'reports' && <ReportsPanel office={current} reports={reports} agents={office.agents} onClose={() => setSide(null)} onChanged={refresh} />}
        {side?.kind === 'meetings' && <MeetingsPanel meetings={meetings} agents={office.agents} initialId={side.id} onClose={() => setSide(null)} />}
      </div>

      {claude && !claude.ok && (
        <div className="modal-bg"><div className="modal">
          <h2>{'Claude Code no está disponible'}</h2>
          <p className="sub">{claude.error}</p>
          <p className="md">Los agentes funcionan con tu suscripción a través del CLI <code>claude</code>. Instálalo y luego inicia sesión una vez en una terminal:</p>
          <pre>curl -fsSL https://claude.ai/install.sh | bash{'\n'}claude</pre>
          <div className="actions"><button className="primary" onClick={() => window.api.checkClaude().then(setClaude)}>{'Volver a comprobar'}</button></div>
        </div></div>
      )}
      {showNew && <NewAgentModal office={current} onClose={() => setShowNew(false)} onCreated={(a) => { setShowNew(false); refresh().then(() => setSide({ kind: 'agent', slug: a.slug })) }} />}
      {showNewOffice && <NewOfficeModal onClose={() => setShowNewOffice(false)} onCreated={(m) => { setShowNewOffice(false); switchOffice(m.slug); refresh() }} />}
      {showMeeting && <MeetingModal office={current} agents={office.agents} onClose={() => setShowMeeting(false)} onStarted={(id) => { setShowMeeting(false); refresh(); setSide({ kind: 'meetings', id }) }} />}
    </div>
    </div>
  )
}
