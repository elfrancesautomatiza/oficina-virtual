import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { jobOf } from '@shared/types'
import type { AgentAlerts, AgentConfig, AgentSession, ChatMessage, FoundPath, InboxItem, RunnerEvent } from '@shared/types'
import { Avatar } from './Avatar'
import { AgentSettings } from './AgentSettings'
import { VoiceButton } from './VoiceButton'
import { VoiceSetup } from './VoiceSetup'
import { QuickActions } from './QuickActions'
import { AccessTab } from './AccessTab'
import { stripVoicePrefix } from '@shared/voice'

interface Props { office: string; agent: AgentConfig; alerts?: AgentAlerts; busy: boolean; onClose: () => void; onChanged: () => void; /** Ouverte depuis la messagerie : se placer sur le 1er message arrivé après cette date */ unreadSince?: string }
type Tab = 'chat' | 'inbox' | 'memory' | 'access' | 'settings'

export function AgentPanel({ office, agent, alerts, busy, onClose, onChanged, unreadSince }: Props): React.JSX.Element {
  const [since] = useState(unreadSince ?? '')
  const sepRef = useRef<HTMLDivElement>(null)
  const sepDone = useRef(false)
  const [tab, setTab] = useState<Tab>('chat')
  const [missingAccess, setMissingAccess] = useState(0)
  useEffect(() => { window.api.listAccess(office, agent.slug).then((r) => setMissingAccess(r.filter((x) => !x.ready).length)).catch(() => undefined) }, [office, agent.slug, busy])
  const [session, setSession] = useState<AgentSession>({ sessionId: null, messages: [] })
  const [stream, setStream] = useState<string[]>([])
  // Message affiché tout de suite à l'envoi (avant que le serveur l'ait enregistré) : envoi… / envoyé / échec.
  const [pending, setPending] = useState<Array<{ id: string; text: string; status: 'sending' | 'sent' | 'failed'; base: number; spoken: boolean; error?: string }>>([])
  const [memory, setMemory] = useState('')
  const [input, setInput] = useState('')
  const [images, setImages] = useState<Array<{ rel: string; url: string }>>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([])
  const [openInbox, setOpenInbox] = useState<{ item: InboxItem; content: string } | null>(null)
  const [voiceMode, setVoiceMode] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [voiceCheck, setVoiceCheck] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [listenNow, setListenNow] = useState(false)
  const voiceModeRef = useRef(false)
  // ---- Conversation vocale : file de phrases à dire, relance du micro, interruption.
  const speech = useRef<{ queue: string[]; pumping: boolean; voiceTurn: boolean; gotText: boolean; runDone: boolean; filler: number | null }>({ queue: [], pumping: false, voiceTurn: false, gotText: false, runDone: true, filler: null })
  const [voices, setVoices] = useState<string[]>([])
  const [voiceName, setVoiceName] = useState<string>(() => { try { return localStorage.getItem('bv-voice') ?? '' } catch { return '' } })
  const voiceNameRef = useRef(voiceName); voiceNameRef.current = voiceName
  const [toggleMic, setToggleMic] = useState(0)
  const [micState, setMicState] = useState<'idle' | 'rec' | 'busy'>('idle')
  const maybeReopen = (): void => { const s = speech.current; if (voiceModeRef.current && s.runDone && !s.pumping) setListenNow(true) }
  const pump = async (): Promise<void> => {
    const s = speech.current
    if (s.pumping) return
    s.pumping = true; setSpeaking(true)
    while (s.queue.length) { const t = s.queue.shift() as string; await window.api.speak(t, voiceNameRef.current || undefined) }
    s.pumping = false; setSpeaking(false)
    maybeReopen()
  }
  const say = (t: string): void => { speech.current.queue.push(t); void pump() }
  const interrupt = (): void => { speech.current.queue = []; window.api.stopSpeaking() }
  const clearFiller = (): void => { const s = speech.current; if (s.filler) { clearTimeout(s.filler); s.filler = null } }
  useEffect(() => { voiceModeRef.current = voiceMode; if (!voiceMode) { clearFiller(); interrupt(); setListenNow(false) } else { setListenNow(true); window.api.listVoices().then(setVoices) } }, [voiceMode])
  useEffect(() => { try { localStorage.setItem('bv-voice', voiceName) } catch { /* ignore */ } }, [voiceName])
  useEffect(() => {
    if (!voiceMode) return
    const k = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      e.preventDefault()
      if (speech.current.pumping) { interrupt(); if (speech.current.runDone) setListenNow(true); return }
      if (!busy) setToggleMic((n) => n + 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [voiceMode, busy])
  const endRef = useRef<HTMLDivElement>(null)
  const msgsRef = useRef<HTMLDivElement>(null)
  // Collé en bas tant que tu n'es pas remonté lire l'historique.
  const stickRef = useRef(true)
  const toBottom = (): void => { const el = msgsRef.current; if (el) el.scrollTop = el.scrollHeight }

  const load = (): void => { window.api.getSession(office, agent.slug).then(setSession) }
  const loadInbox = (): void => { window.api.listInbox(office, agent.slug).then(setInboxItems) }

  useEffect(() => {
    load(); loadInbox()
    window.api.markSeen(office, agent.slug)
    const off = window.api.onRunner((ev: RunnerEvent) => {
      if (ev.office !== office || ev.agentSlug !== agent.slug) return
      if (ev.kind === 'text' && ev.text) {
        setStream((s) => [...s, ev.text!])
        if (voiceModeRef.current && speech.current.voiceTurn) { speech.current.gotText = true; clearFiller(); say(ev.text) }
      }
      if (ev.kind === 'tool') load()
      if (ev.kind === 'result' && ev.text && voiceModeRef.current && speech.current.voiceTurn && !speech.current.gotText) say(ev.text)
      if (ev.kind === 'error' && voiceModeRef.current && speech.current.voiceTurn) { clearFiller(); say('Lo siento, tuve un error. Mira el mensaje en la pantalla.') }
      if (ev.kind === 'end') {
        clearFiller(); speech.current.runDone = true; maybeReopen(); setStream([]); load(); window.api.markSeen(office, agent.slug) }
    })
    const offAlerts = window.api.onAlerts(() => loadInbox())
    return () => { off(); offAlerts() }
  }, [office, agent.slug])

  useEffect(() => { if (tab === 'memory') window.api.readMemory(office, agent.slug).then(setMemory) }, [tab, office, agent.slug])
  useLayoutEffect(() => { if (stickRef.current) toBottom() }, [session.messages.length, stream.length, tab, pending.length, busy])
  const countUser = (txt: string): number => session.messages.filter((m) => m.role === 'user' && m.text.trim() === txt.trim()).length
  useEffect(() => { setPending((ps) => ps.filter((p) => p.status === 'failed' || countUser(p.text) <= p.base)) }, [session.messages]) // eslint-disable-line react-hooks/exhaustive-deps
  // Ouverture depuis la messagerie : on se place sur le premier message non lu (comme WhatsApp)
  useLayoutEffect(() => {
    if (sepDone.current || !session.messages.length) return
    sepDone.current = true
    const el = sepRef.current, box = msgsRef.current
    if (el && box) { box.scrollTop = Math.max(0, el.offsetTop - box.offsetTop - 12); stickRef.current = false }
  }, [session.messages.length])
  useEffect(() => {
    // Le contenu grandit après coup (boutons de fichiers, retours à la ligne) : on reste en bas si on y était.
    const el = msgsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (stickRef.current) toBottom() })
    for (const child of Array.from(el.children)) ro.observe(child)
    ro.observe(el)
    return () => ro.disconnect()
  }, [session.messages.length, tab])

  const addImages = async (files: File[]): Promise<void> => {
    for (const f of files.filter((x) => x.type.startsWith('image/'))) {
      try {
        const rel = await window.api.saveImage(office, agent.slug, new Uint8Array(await f.arrayBuffer()), f.type)
        const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f) })
        setImages((l) => [...l, { rel, url }])
      } catch (e) { alert((e as Error).message) }
    }
  }
  const onPaste = (e: React.ClipboardEvent): void => {
    const files = Array.from(e.clipboardData.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length) { e.preventDefault(); void addImages(files) }
  }

  const send = async (text = input, spoken = false): Promise<void> => {
    let t = text.trim()
    if ((!t && !images.length) || busy) return
    if (images.length) {
      t = `${t || 'Mira esta imagen.'}\n\n${images.map((i) => `${IMG_MARK} \`${i.rel}\``).join('\n')}\n(Abre cada imagen adjunta con la herramienta Read antes de responder.)`
      setImages([])
    }
    setInput('')
    stickRef.current = true
    const sp = speech.current
    sp.voiceTurn = spoken; sp.gotText = false; sp.runDone = false
    clearFiller()
    if (spoken) {
      const fillers = ['Déjame ver.', 'Un segundo.', 'Ok, lo reviso.']
      sp.filler = window.setTimeout(() => { sp.filler = null; if (!sp.gotText && !sp.runDone) say(fillers[Math.floor(Math.random() * fillers.length)]) }, 2500)
    }
    const id = `p-${Date.now()}`
    setPending((ps) => [...ps, { id, text: t, status: 'sending', base: countUser(t), spoken }])
    await deliver(id, t, spoken)
  }
  const deliver = async (id: string, t: string, spoken: boolean): Promise<void> => {
    try {
      await window.api.send(office, agent.slug, t, { voice: spoken })
      setPending((ps) => ps.map((p) => (p.id === id ? { ...p, status: 'sent' } : p)))
      load()
    } catch (e) {
      speech.current.runDone = true; clearFiller()
      setPending((ps) => ps.map((p) => (p.id === id ? { ...p, status: 'failed', error: (e as Error).message } : p)))
    }
  }

  const showInbox = async (item: InboxItem): Promise<void> => {
    const content = await window.api.readInbox(office, agent.slug, item.file)
    setOpenInbox({ item, content })
    if (!item.read) { await window.api.markInboxRead(office, agent.slug, item.file); loadInbox() }
  }

  const unreadInbox = inboxItems.filter((i) => !i.read).length

  return (
    <aside className="side">
      <div className="side-head" style={{ ['--c' as string]: agent.color }}>
        <Avatar spec={agent.avatar} size={44} />
        <div className="t"><b>{agent.name}</b><span><span className="job-pill">{jobOf(agent)}</span>{agent.tagline}</span></div>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>{'Conversación'}</button>
        <button className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>Para ti{unreadInbox > 0 && <span className="badge">{unreadInbox}</span>}</button>
        <button className={tab === 'memory' ? 'on' : ''} onClick={() => setTab('memory')}>{'Memoria'}</button>
        <button className={tab === 'access' ? 'on' : ''} onClick={() => setTab('access')}>Accesos{missingAccess > 0 && <span className="badge">{missingAccess}</span>}</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>{'Ajustes'}</button>
      </div>
      <div className="side-body">
        {tab === 'chat' && (
          <div className="chat">
            {alerts && alerts.unreadReports > 0 && <div className="notice">{agent.name} tiene {alerts.unreadReports} {alerts.unreadReports > 1 ? 'informes no leídos' : 'informe no leído'} (botón Informes arriba).</div>}
            <QuickActions office={office} slug={agent.slug} name={agent.name} busy={busy} onSend={(t) => { void send(t) }} />
            <div className="msgs" ref={msgsRef} onScroll={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
              {session.messages.length === 0 && <div className="empty">Primera conversación con {agent.name}. Leerá su memoria y su CLAUDE.md antes de responder.</div>}
              {(() => {
                const first = since ? session.messages.findIndex((m) => m.role !== 'user' && m.role !== 'tool' && m.at > since) : -1
                const n = first < 0 ? 0 : session.messages.slice(first).filter((m) => m.role === 'assistant').length
                return session.messages.map((m, i) => (
                  <React.Fragment key={m.id}>
                    {i === first && <div className="unread-sep" ref={sepRef}><span>{n > 1 ? `${n} mensajes no leídos` : 'No leído'}</span></div>}
                    <Msg m={m} office={office} slug={agent.slug} />
                  </React.Fragment>
                ))
              })()}
              {pending.map((p) => (
                <div key={p.id} className={`msg user pending ${p.status}`}>
                  {p.text.split(`\n\n${IMG_MARK}`)[0]}
                  <div className="msg-status">{p.status === 'sending' ? 'enviando…' : p.status === 'sent' ? 'enviado' : <button onClick={() => { setPending((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: 'sending' } : x))); void deliver(p.id, p.text, p.spoken) }}>{'Falló — reintentar'}</button>}{p.status === 'failed' && p.error && <div>{p.error}</div>}</div>
                </div>
              ))}
              {stream.length > 0 && <div className="msg assistant streaming">{stream.join('\n')}</div>}
              {(busy || pending.some((p) => p.status === 'sent')) && stream.length === 0 && <div className="msg system typing">{agent.name.split(' ')[0]} {'escribe…'}</div>}
              <div ref={endRef} />
            </div>
            <div className="composer">
              {images.length > 0 && (
                <div className="paste-thumbs">
                  {images.map((i) => (
                    <span key={i.rel} className="paste-thumb"><img src={i.url} alt="" /><button title={'Quitar'} onClick={() => setImages((l) => l.filter((x) => x.rel !== i.rel))}>✕</button></span>
                  ))}
                </div>
              )}
              <textarea
                className={dragOver ? 'drag' : ''}
                onPaste={onPaste}
                onDragOver={(e) => { if (Array.from(e.dataTransfer.items).some((it) => it.type.startsWith('image/'))) { e.preventDefault(); setDragOver(true) } }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { setDragOver(false); const f = Array.from(e.dataTransfer.files).filter((x) => x.type.startsWith('image/')); if (f.length) { e.preventDefault(); void addImages(f) } }}
                value={input}
                placeholder={`Habla con ${agent.name}…  (⌘⏎ para enviar, o el micrófono)`}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
              />
              <VoiceButton
                office={office} slug={agent.slug} disabled={busy || speaking}
                toggle={toggleMic} silenceMs={voiceMode ? 1600 : 2500} onState={setMicState}
                autoStart={voiceMode && listenNow && !busy && !speaking}
                onUnavailable={() => setVoiceMode(false)}
                onNeedSetup={() => { setVoiceMode(false); setShowSetup(true) }}
                recheck={voiceCheck}
                onText={(t) => { setListenNow(false); if (voiceMode) { void send(t, true) } else setInput((v) => (v ? v + ' ' : '') + t) }}
              />
              <button className={voiceMode ? 'primary' : ''} title={'Modo voz: hablas, se envía, el agente responde en voz alta y el micrófono se vuelve a abrir'} onClick={async () => { if (!voiceMode) { const st = await window.api.checkVoice(); if (!st.ok) { setShowSetup(true); return } } setVoiceMode((v) => !v) }}>{voiceMode ? '🔊 On' : '🔊'}</button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); e.target.value = '' }} />
              <button title={'Adjuntar una imagen (o pégala con ⌘V, o arrástrala aquí)'} onClick={() => fileRef.current?.click()}>🖼</button>
              {busy
                ? <button className="danger" onClick={() => window.api.stop(office, agent.slug)}>{'Detener'}</button>
                : <button className="primary" onClick={() => send()} disabled={!input.trim() && !images.length}>{'Enviar'}</button>}
            </div>
            {voiceMode && (
              <div className={`voice-bar ${speaking ? 'speak' : micState === 'rec' ? 'rec' : busy || micState === 'busy' ? 'think' : ''}`}>
                <span className="vb-dot" />
                <span className="vb-t">
                  {speaking ? `${agent.name.split(' ')[0]} habla · Espacio para interrumpir`
                    : micState === 'rec' ? 'Te escucho… (Espacio para enviar ya)'
                    : micState === 'busy' ? 'Transcribiendo…'
                    : busy ? `${agent.name.split(' ')[0]} piensa…`
                    : 'Espacio para hablar'}
                </span>
                {voices.length > 0 && (
                  <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} title={'Voz'}>
                    <option value="">{'Voz auto'}</option>
                    {voices.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                )}
                {voices.length > 0 && !voices.some((v) => /premium|enhanced|amélior/i.test(v)) && (
                  <button className="vb-link" title="Ajustes del Sistema → Accesibilidad → Contenido leído → Voz del sistema → Gestionar voces → Español → marca una voz (Mejorada), luego vuelve y reactiva el modo voz." onClick={() => window.api.openVoiceSettings()}>{'Voz más natural'}</button>
                )}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="hint">{voiceMode ? '' : session.sessionId ? `Sesión ${session.sessionId.slice(0, 8)} · memoria separada` : 'Nueva sesión'}</span>
              <button style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => { if (confirm('¿Nueva conversación? La memoria larga se conserva.')) window.api.resetSession(office, agent.slug).then(load) }}>{'Nueva conversación'}</button>
            </div>
          </div>
        )}
        {tab === 'inbox' && (
          openInbox ? (
            <div>
              <button onClick={() => setOpenInbox(null)} style={{ marginBottom: 10 }}>{'← Volver'}</button>
              <div className="hint">{openInbox.item.kind === 'question' ? 'Pregunta' : 'Información'} · {new Date(openInbox.item.at).toLocaleString('es-CL')}</div>
              <div className="md" style={{ marginTop: 8 }}>{openInbox.content.replace(/^kind:.*\n/, '')}</div>
              {openInbox.item.kind === 'question' && (
                <button className="primary" style={{ marginTop: 12 }} onClick={() => { setTab('chat'); setInput(`Sobre «${openInbox.item.title}»: `) }}>{'Responder en la conversación'}</button>
              )}
            </div>
          ) : (
            <div className="list">
              <div className="hint">Lo que {agent.name} anotó para ti fuera de las conversaciones (rutinas, reuniones). Lo escribe en su carpeta inbox/.</div>
              {inboxItems.length === 0 && <div className="empty">{'Nada por ahora.'}</div>}
              {inboxItems.map((i) => (
                <div key={i.file} className={`item ${i.read ? '' : 'unread'}`} style={{ cursor: 'pointer' }} onClick={() => showInbox(i)}>
                  <h4>{i.kind === 'question' ? '? ' : '• '}{i.title}</h4>
                  <div className="m">{new Date(i.at).toLocaleString('es-CL')}{i.read ? '' : ' · no leído'}</div>
                </div>
              ))}
            </div>
          )
        )}
        {tab === 'memory' && (
          <div>
            <div className="hint" style={{ marginBottom: 8 }}>offices/{office}/agents/{agent.slug}/memory/MEMORY.md — el agente la relee en cada conversación y la actualiza solo.</div>
            <pre className="md" style={{ whiteSpace: 'pre-wrap' }}>{memory || '(vacía)'}</pre>
          </div>
        )}
        {tab === 'access' && <AccessTab office={office} slug={agent.slug} name={agent.name} onCount={setMissingAccess} />}
        {tab === 'settings' && <AgentSettings office={office} agent={agent} onChanged={onChanged} />}
      </div>
      {showSetup && <VoiceSetup onClose={() => setShowSetup(false)} onReady={() => setVoiceCheck((n) => n + 1)} />}
    </aside>
  )
}

const IMG_MARK = '📎 Imagen adjunta:'
const IMG_RE = /📎 Imagen adjunta: `(captures\/[^`]+)`/g

function Msg({ m, office, slug }: { m: ChatMessage; office: string; slug: string }): React.JSX.Element {
  if (m.role === 'tool') return <div className="msg tool">⚙ {m.text}</div>
  if (m.role === 'user' && m.text.includes(IMG_MARK)) {
    const rels = [...m.text.matchAll(IMG_RE)].map((x) => x[1])
    const text = m.text.replace(IMG_RE, '').replace("(Abre cada imagen adjunta con la herramienta Read antes de responder.)", '').trim()
    return <div className={`msg ${m.role}`}>{text}<div className="msg-imgs">{rels.map((r) => <MsgImage key={r} office={office} slug={slug} rel={r} />)}</div></div>
  }
  if (m.role !== 'assistant') return <div className={`msg ${m.role}`}>{m.role === 'user' ? stripVoicePrefix(m.text) : m.text}</div>
  return (
    <div className="msg-wrap">
      <div className={`msg ${m.role}`}>{m.text}</div>
      <PathLinks office={office} slug={slug} text={m.text} />
    </div>
  )
}

/** Boutons sous un message : ouvrir dans le Finder / modifier les fichiers que l'agent cite. */
function PathLinks({ office, slug, text }: { office: string; slug: string; text: string }): React.JSX.Element | null {
  const [found, setFound] = useState<FoundPath[]>([])
  useEffect(() => {
    if (!/[/`]/.test(text)) return
    let alive = true
    window.api.findPaths(office, slug, text).then((f) => { if (alive) setFound(f) })
    return () => { alive = false }
  }, [office, slug, text])
  if (!found.length) return null
  return (
    <div className="path-links">
      {found.map((p) => (
        <span key={p.abs} className="path-link" title={p.abs}>
          <button onClick={() => window.api.revealPath(p.abs)}>{p.isDir ? '📁' : '📄'} {p.name}<span className="hint"> · Finder</span></button>
          {p.editable && <button onClick={() => window.api.openFile(p.abs)}>{'Editar'}</button>}
        </span>
      ))}
    </div>
  )
}

function MsgImage({ office, slug, rel }: { office: string; slug: string; rel: string }): React.JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null)
  const [big, setBig] = useState(false)
  useEffect(() => { window.api.readImage(office, slug, rel).then(setUrl) }, [office, slug, rel])
  if (!url) return null
  return <img src={url} alt="" className={big ? 'big' : ''} title={'Clic para ampliar'} onClick={() => setBig((x) => !x)} />
}
