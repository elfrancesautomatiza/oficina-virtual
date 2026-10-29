import React, { useEffect, useRef, useState } from 'react'
import type { VoiceStatus } from '@shared/types'

/** Installe les vocaux depuis l'app : ffmpeg, whisper, modèle. */
export function VoiceSetup({ onClose, onReady }: { onClose: () => void; onReady: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [result, setResult] = useState<null | boolean>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    window.api.checkVoice().then(setStatus)
    return window.api.onVoiceInstall((ev) => {
      if (ev.line) setLines((l) => [...l.slice(-200), ev.line!])
      if (ev.done) { setRunning(false); setResult(!!ev.ok); if (ev.status) setStatus(ev.status); if (ev.ok) onReady() }
    })
  }, [])
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [lines.length])

  const step = lines.filter((l) => l.startsWith('PASO:')).pop()?.replace('PASO:', '').trim()
  const error = lines.find((l) => l.startsWith('ERROR:'))
  const brewCmd = lines.find((l) => l.includes('Homebrew/install'))
  const Item = ({ ok, label }: { ok?: boolean; label: string }): React.JSX.Element => <div className="check" style={{ margin: '4px 0' }}><span className={`dot ${ok ? 'ok' : 'err'}`} /> {label}</div>

  return (
    <div className="modal-bg" onClick={running ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <h2>Activar los audios</h2>
        <div className="sub">Transcripción local con Whisper: nada sale de tu Mac. Solo una vez, de 5 a 10 minutos (descarga de unos 500 MB).</div>
        {status && <>
          <Item ok={status.ffmpeg} label="ffmpeg (conversión de audio)" />
          <Item ok={status.whisper} label="whisper (reconocimiento de voz)" />
          <Item ok={status.model} label="modelo de voz" />
        </>}
        {(running || lines.length > 0) && (
          <>
            <div className="hint" style={{ marginTop: 10 }}>{running ? `En curso: ${step ?? 'iniciando'}…` : result ? 'Listo.' : 'Detenido.'}</div>
            <pre ref={logRef} style={{ maxHeight: 160, overflow: 'auto', background: 'var(--bg)', padding: 8, borderRadius: 8, fontSize: 11 }}>{lines.join('\n')}</pre>
          </>
        )}
        {error && !running && (
          <div className="notice" style={{ marginTop: 8 }}>
            {error.replace('ERROR:', '').trim()}
            {brewCmd && <><br />Pega esto en la Terminal, escribe la contraseña de tu Mac cuando te la pida y luego vuelve y haz clic en Instalar:<pre style={{ whiteSpace: 'pre-wrap', userSelect: 'all' }}>{brewCmd}</pre></>}
          </div>
        )}
        <div className="actions">
          <button onClick={onClose} disabled={running}>{result ? 'Cerrar' : 'Más tarde'}</button>
          {!status?.ok && <button className="primary" disabled={running} onClick={() => { setLines([]); setResult(null); setRunning(true); window.api.installVoice() }}>{running ? 'Instalando…' : lines.length ? 'Reintentar' : 'Instalar'}</button>}
        </div>
      </div>
    </div>
  )
}
