import React, { useEffect, useRef, useState } from 'react'
import type { VoiceStatus } from '@shared/types'

interface Props { office: string; slug: string; disabled?: boolean; onText: (text: string) => void; /** mode conversation : démarre l'enregistrement dès que possible */ autoStart?: boolean; onUnavailable?: () => void; /** appelé quand les vocaux ne sont pas installés */ onNeedSetup?: () => void; /** incrémenter pour revérifier l'installation */ recheck?: number; /** incrémenter pour démarrer / arrêter (raccourci clavier) */ toggle?: number; /** silence avant envoi en mode conversation */ silenceMs?: number; onState?: (s: 'idle' | 'rec' | 'busy') => void }

/** Un clic : enregistre. Un second clic : arrête et transcrit. Le texte arrive dans la zone de message. */
export function VoiceButton({ office, slug, disabled, onText, autoStart, onUnavailable, onNeedSetup, recheck, toggle, silenceMs = 2500, onState }: Props): React.JSX.Element {
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [secs, setSecs] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<number | null>(null)

  useEffect(() => { window.api.checkVoice().then(setStatus) }, [recheck])
  useEffect(() => { onState?.(state) }, [state])
  useEffect(() => { if (!toggle) return; if (state === 'rec') stop(); else if (state === 'idle') void start() }, [toggle])
  useEffect(() => {
    if (autoStart && !disabled && state === 'idle' && status?.ok) { void start() }
    if (autoStart && status && !status.ok) onUnavailable?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, disabled, status?.ok, state])

  const start = async (): Promise<void> => {
    if (!status?.ok) { if (onNeedSetup) onNeedSetup(); else alert(status?.hint ?? 'Audios no configurados.'); window.api.checkVoice().then(setStatus); return }
    if (!(await window.api.askMic())) {
      alert('Oficina Virtual no tiene acceso al micrófono. Ve a Ajustes del Sistema → Privacidad y seguridad → Micrófono → activa Oficina Virtual y vuelve a intentarlo.')
      onUnavailable?.(); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const r = new MediaRecorder(stream, { mimeType: mime })
      chunks.current = []
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setState('busy')
        try {
          const blob = new Blob(chunks.current, { type: mime })
          const buf = new Uint8Array(await blob.arrayBuffer())
          const res = await window.api.transcribe(office, slug, buf, mime)
          if (res.error) alert(res.error)
          else if (res.text) onText(res.text)
        } finally { setState('idle') }
      }
      r.start()
      rec.current = r
      if (autoStart) watchSilence(stream, () => stop())
      setState('rec'); setSecs(0)
      timer.current = window.setInterval(() => setSecs((s) => s + 1), 1000)
    } catch (e) {
      alert(`Micrófono no disponible: ${(e as Error).message}\n\nRevisa Ajustes del Sistema → Privacidad y seguridad → Micrófono → Oficina Virtual.`)
      onUnavailable?.()
    }
  }

  const watchSilence = (stream: MediaStream, onSilence: () => void): void => {
    try {
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an)
      const buf = new Uint8Array(an.fftSize)
      let spoke = false, quietSince = 0
      const tick = (): void => {
        if (!rec.current) { ctx.close(); return }
        an.getByteTimeDomainData(buf)
        let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d }
        const rms = Math.sqrt(sum / buf.length)
        const now = performance.now()
        if (rms > 0.02) { spoke = true; quietSince = 0 }
        else if (spoke) { if (!quietSince) quietSince = now; else if (now - quietSince > silenceMs) { ctx.close(); onSilence(); return } }
        else if (now - t0 > 15000) { ctx.close(); onSilence(); return } // rien dit en 15 s
        requestAnimationFrame(tick)
      }
      const t0 = performance.now()
      requestAnimationFrame(tick)
    } catch { /* pas d'analyse, arrêt manuel */ }
  }

  const stop = (): void => {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    rec.current?.stop()
    rec.current = null
  }

  const label = state === 'rec' ? `■ ${secs}s` : state === 'busy' ? '…' : '🎙'
  const title = status?.ok ? (state === 'rec' ? 'Detener y transcribir' : 'Grabar un audio') : (status?.hint ?? '')
  return (
    <button
      className={`voice ${state}`}
      title={title}
      disabled={disabled || state === 'busy'}
      onClick={() => (state === 'rec' ? stop() : start())}
      style={{ opacity: status && !status.ok ? 0.6 : 1 }}
    >{label}</button>
  )
}
