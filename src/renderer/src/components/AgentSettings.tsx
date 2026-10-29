import React from 'react'
import { useEffect, useState } from 'react'
import type { AgentConfig, Routine } from '@shared/types'

const DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const TZS: Array<[string, string]> = [
  ['', 'Hora del Mac'], ['America/Bogota', 'Bogotá'], ['America/Santiago', 'Santiago'], ['America/Mexico_City', 'Ciudad de México'],
  ['America/New_York', 'New York'], ['Europe/Paris', 'París / Bruselas'], ['Europe/Madrid', 'Madrid'], ['Europe/London', 'Londres'],
  ['Asia/Dubai', 'Dubái'], ['Asia/Bangkok', 'Bangkok'], ['Asia/Tokyo', 'Tokio'], ['UTC', 'UTC']
]
const TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebSearch', 'WebFetch']
const CLOUD_CONNECTORS = ['Canva', 'Gmail', 'Google Drive', 'Google Sheets', 'Google Calendar', 'Notion', 'Slack', 'Figma', 'Metricool Social Media Management']
const PRESETS: Array<{ name: string; label: string; cfg: Record<string, unknown> }> = [
  { name: 'canva', label: 'Canva', cfg: { type: 'http', url: 'https://mcp.canva.com/mcp' } },
  { name: 'notion', label: 'Notion', cfg: { type: 'http', url: 'https://mcp.notion.com/mcp' } },
  { name: 'github', label: 'GitHub', cfg: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } },
  { name: 'google-drive', label: 'Google Drive', cfg: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-gdrive'] } },
  { name: 'slack', label: 'Slack', cfg: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] } },
  { name: 'postgres-lectura', label: 'Postgres (lectura)', cfg: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost:5432/mi_base'] } }
]

export function AgentSettings({ office, agent, onChanged }: { office: string; agent: AgentConfig; onChanged: () => void }): React.JSX.Element {
  const [a, setA] = useState<AgentConfig>(agent)
  const [claudeMd, setClaudeMd] = useState('')
  const [editMd, setEditMd] = useState(false)
  const [skills, setSkills] = useState<{ own: string[]; global: string[]; dir: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [promptText, setPromptText] = useState('')

  useEffect(() => { setA(agent) }, [agent])
  useEffect(() => { window.api.readClaudeMd(office, agent.slug).then(setClaudeMd) }, [agent.slug])

  // N'envoie que ce qui a changé : une fiche modifiée ailleurs (par un agent, une routine, Claude) n'est jamais écrasée.
  const save = async (next: AgentConfig): Promise<void> => {
    const changes: Record<string, { prev: unknown; next: unknown }> = {}
    for (const k of Object.keys(next) as Array<keyof AgentConfig>) {
      if (JSON.stringify(next[k]) !== JSON.stringify(a[k])) changes[k] = { prev: a[k], next: next[k] }
    }
    setA(next)
    if (!Object.keys(changes).length) return
    setA(await window.api.patchAgent(office, a.slug, changes))
    onChanged()
  }

  const addFolder = async (): Promise<void> => {
    const f = await window.api.pickFolder()
    if (f && !a.folders.includes(f)) await save({ ...a, folders: [...a.folders, f] })
  }
  const toggleTool = (t: string): void => {
    const has = a.allowedTools.includes(t)
    save({ ...a, allowedTools: has ? a.allowedTools.filter((x) => x !== t) : [...a.allowedTools, t] })
  }
  const updRoutine = (id: string, patch: Partial<Routine>): void => { void save({ ...a, routines: a.routines.map((r) => (r.id === id ? { ...r, ...patch } : r)) }) }
  const addRoutine = async (): Promise<void> => {
    const id = `routine-${Date.now().toString(36)}`
    const template = `# Nueva rutina\n\nDescribe aquí lo que ${a.name} debe hacer en cada ejecución, paso a paso:\n1. Lo que debe leer primero (memoria, carpetas, archivos).\n2. El trabajo a producir y dónde escribirlo.\n3. Lo que debe poner en su informe (si la rutina escribe un informe).\n\nOjo: nadie lee en directo. Si tiene una pregunta que lo bloquea, la escribe en inbox/ en vez de preguntarla.\n`
    await window.api.writeRoutine(office, a.slug, `${id}.md`, template)
    await save({ ...a, routines: [...a.routines, { id, label: 'Nueva rutina', time: '08:00', days: [], promptFile: `${id}.md`, enabled: false, writesReport: true }] })
    setEditing(id); setPromptText(template)
  }
  const openRoutine = async (r: Routine): Promise<void> => {
    if (editing === r.id) { setEditing(null); return }
    setPromptText(await window.api.readRoutine(office, a.slug, r.promptFile))
    setEditing(r.id)
  }
  const saveRoutine = async (r: Routine): Promise<void> => {
    await window.api.writeRoutine(office, a.slug, r.promptFile, promptText)
    setEditing(null)
  }

  return (
    <div>
      <h4 style={{ margin: '4px 0 6px' }}>{'Cargo mostrado en la oficina'}</h4>
      <div className="hint">Una o dos palabras bajo el nombre, para ver de un vistazo quién hace qué.</div>
      <input style={{ margin: '6px 0 14px' }} defaultValue={a.job ?? ''} key={a.slug} placeholder={a.role} maxLength={32}
        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (a.job ?? '')) void save({ ...a, job: v || undefined }) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <h4 style={{ margin: '4px 0 6px' }}>{'Carpetas accesibles'}</h4>
      <div className="hint">El agente trabaja en su carpeta y en las que estén aquí (se pasan con --add-dir al CLI).</div>
      <div className="list" style={{ margin: '8px 0' }}>
        {a.folders.map((f) => (
          <div key={f} className="row item" style={{ justifyContent: 'space-between' }}>
            <code style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</code>
            <span className="chip x" onClick={() => save({ ...a, folders: a.folders.filter((x) => x !== f) })}>{'quitar'}</span>
          </div>
        ))}
        <button onClick={addFolder}>{'+ Agregar una carpeta'}</button>
      </div>

      <h4 style={{ margin: '16px 0 6px' }}>{'Conectores de tu cuenta claude.ai'}</h4>
      <div className="hint">Los que ya conectaste en claude.ai (Ajustes → Conectores). No hay que volver a autorizar: marca los que este agente puede usar.</div>
      <div className="row wrap" style={{ margin: '6px 0 4px' }}>
        {[...new Set([...CLOUD_CONNECTORS, ...(a.claudeAiConnectors ?? [])])].map((n) => {
          const on = (a.claudeAiConnectors ?? []).includes(n)
          return <span key={n} className="chip" style={{ cursor: 'pointer', borderColor: on ? 'var(--accent)' : undefined, color: on ? 'var(--text)' : undefined }}
            onClick={() => save({ ...a, claudeAiConnectors: on ? (a.claudeAiConnectors ?? []).filter((x) => x !== n) : [...(a.claudeAiConnectors ?? []), n] })}>{on ? '✓ ' : ''}{n}</span>
        })}
        <span className="chip" style={{ cursor: 'pointer' }} onClick={() => { const n = prompt('Nombre exacto del conector tal como aparece en claude.ai (ej. Asana)'); if (n?.trim()) save({ ...a, claudeAiConnectors: [...(a.claudeAiConnectors ?? []), n.trim()] }) }}>+ otro</span>
      </div>

      <h4 style={{ margin: '16px 0 6px' }}>{'Conectores propios del agente (MCP)'}</h4>
      <div className="hint">Notion, Google Drive, Slack, GitHub… El agente solo tiene los conectores de esta lista. Primer uso de un conector con autenticación: mira el comando bajo la lista.</div>
      <div className="list" style={{ margin: '8px 0' }}>
        {Object.entries(a.mcpServers ?? {}).map(([name, cfg]) => (
          <div key={name} className="row item" style={{ justifyContent: 'space-between' }}>
            <div><b>{name}</b> <code className="hint">{String((cfg as Record<string, unknown>).url ?? (cfg as Record<string, unknown>).command ?? '')}</code></div>
            <span className="chip x" onClick={() => { const m = { ...(a.mcpServers ?? {}) }; delete m[name]; save({ ...a, mcpServers: m }) }}>{'quitar'}</span>
          </div>
        ))}
        <div className="row wrap">
          {PRESETS.filter((p) => !(a.mcpServers ?? {})[p.name]).map((p) => (
            <button key={p.name} onClick={() => save({ ...a, mcpServers: { ...(a.mcpServers ?? {}), [p.name]: p.cfg } })}>+ {p.label}</button>
          ))}
          <button onClick={() => {
            const raw = prompt('Pega la config del servidor en formato .mcp.json, ej. {"miservidor":{"type":"http","url":"https://…/mcp"}} o {"x":{"command":"npx","args":["-y","@pkg/mcp"]}}')
            if (!raw) return
            try { const obj = JSON.parse(raw) as Record<string, Record<string, unknown>>; save({ ...a, mcpServers: { ...(a.mcpServers ?? {}), ...obj } }) } catch { alert('JSON no válido') }
          }}>+ Otro…</button>
        </div>
        {Object.keys(a.mcpServers ?? {}).length > 0 && (
          <div className="row" style={{ marginTop: 6, alignItems: 'flex-start' }}>
            <button onClick={() => window.api.mcpAuth(office, a.slug)}>Iniciar sesión…</button>
            <span className="hint">Una sola vez por conector (Canva, Notion…): se abre una Terminal en el lugar correcto. Escribe <code>/mcp</code>, elige el conector, «Authenticate», confirma en el navegador y luego <code>/exit</code>. El token queda guardado.</span>
          </div>
        )}
      </div>

      <h4 style={{ margin: '16px 0 6px' }}>{'Navegador'}</h4>
      <label className="check"><input type="checkbox" checked={!!a.chrome} onChange={(e) => save({ ...a, chrome: e.target.checked })} /> Claude in Chrome — el agente puede controlar tu Chrome (leer páginas, hacer clic, completar). Actúa con tus cuentas conectadas: actívalo solo si su misión lo exige, y pruébalo en una conversación antes de usarlo en rutinas.</label>

      <h4 style={{ margin: '16px 0 6px' }}>Skills</h4>
      <div className="hint">Los suyos: <code>{skills?.dir.replace(/^.*\/offices\//, 'offices/')}</code> (una carpeta por skill, con un SKILL.md). Copia aquí un skill para que solo este agente lo tenga.</div>
      <div className="row wrap" style={{ margin: '6px 0' }}>
        {skills?.own.map((n) => <span key={n} className="chip" style={{ borderColor: 'var(--accent)', color: 'var(--text)' }}>{n}</span>)}
        {skills && skills.own.length === 0 && <span className="hint">{'ningún skill propio'}</span>}
        <button style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => { window.api.openPath(skills?.dir ?? ''); window.api.listSkills(office, a.slug).then(setSkills) }}>{'Abrir la carpeta'}</button>
      </div>
      {skills && skills.global.length > 0 && <div className="hint">Comunes a todos los agentes (~/.claude/skills): {skills.global.join(', ')}</div>}

      <h4 style={{ margin: '16px 0 6px' }}>{'Herramientas autorizadas'}</h4>
      <div className="row wrap">
        {TOOLS.map((t) => <span key={t} className="chip" style={{ cursor: 'pointer', borderColor: a.allowedTools.includes(t) ? 'var(--accent)' : undefined, color: a.allowedTools.includes(t) ? 'var(--text)' : undefined }} onClick={() => toggleTool(t)}>{t}</span>)}
      </div>
      <label>{'Modo de permisos (chat)'}</label>
      <select value={a.permissionMode} onChange={(e) => save({ ...a, permissionMode: e.target.value as AgentConfig['permissionMode'] })}>
        <option value="acceptEdits">acceptEdits — edita sus archivos, rechaza lo demás no autorizado</option>
        <option value="dontAsk">dontAsk — rechaza todo lo que no está autorizado</option>
        <option value="plan">plan — solo lectura, propone un plan</option>
        <option value="bypassPermissions">bypassPermissions — autorizar todo (peligroso)</option>
      </select>
      <label>{'Modo de permisos (rutinas automáticas)'}</label>
      <select value={a.routinePermissionMode} onChange={(e) => save({ ...a, routinePermissionMode: e.target.value as AgentConfig['permissionMode'] })}>
        <option value="dontAsk">dontAsk — recomendado</option>
        <option value="acceptEdits">acceptEdits</option>
        <option value="bypassPermissions">bypassPermissions — autorizar todo (peligroso)</option>
      </select>
      <label>{'Modelo (vacío = predeterminado de Claude Code)'}</label>
      <input value={a.model ?? ''} placeholder="ej. sonnet, opus" onChange={(e) => setA({ ...a, model: e.target.value || undefined })} onBlur={() => save(a)} />

      <h4 style={{ margin: '18px 0 6px' }}>{'Rutinas diarias'}</h4>
      <div className="list">
        {a.routines.map((r) => (
          <div key={r.id} className="item">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              {r.source === 'agent' && <span className="chip" title={`Creada por ${a.name} a pedido tuyo`}>de {a.name.split(' ')[0]}</span>}
              <input value={r.label} style={{ width: 'auto', flex: 1 }} onChange={(e) => updRoutine(r.id, { label: e.target.value })} />
              <input type="time" value={r.time} style={{ width: 110 }} onChange={(e) => updRoutine(r.id, { time: e.target.value })} />
              <select value={r.tz ?? ''} style={{ width: 150 }} title="Zona horaria de la hora" onChange={(e) => updRoutine(r.id, { tz: e.target.value || undefined })}>
                {TZS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {r.tz && !TZS.some(([v]) => v === r.tz) && <option value={r.tz}>{r.tz}</option>}
              </select>
              <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={r.enabled} onChange={(e) => updRoutine(r.id, { enabled: e.target.checked })} /> {'activa'}</label>
            </div>
            <div className="row" style={{ marginTop: 6, justifyContent: 'space-between' }}>
              <div className="row" style={{ gap: 4 }}>
                {DAYS.map((d, i) => (
                  <span key={i} className="chip" style={{ cursor: 'pointer', borderColor: (r.days.length === 0 || r.days.includes(i)) ? 'var(--accent)' : undefined }}
                    onClick={() => {
                      const cur = r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6]
                      const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]
                      updRoutine(r.id, { days: next.length === 7 ? [] : next })
                    }}>{d}</span>
                ))}
              </div>
              <span className="m hint">{r.lastRun ? `última: ${new Date(r.lastRun).toLocaleString('es-CL')} (${r.lastStatus})` : 'nunca lanzada'}</span>
            </div>
            <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              <label className="check" style={{ margin: 0, fontSize: 12 }}><input type="checkbox" checked={r.writesReport} onChange={(e) => updRoutine(r.id, { writesReport: e.target.checked })} /> {'escribe un informe'}</label>
              <div className="row">
                <button style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => openRoutine(r)}>{editing === r.id ? 'Cerrar' : 'Instrucciones'}</button>
                <button style={{ padding: '3px 8px', fontSize: 11 }} disabled={r.lastStatus === 'running'} onClick={() => window.api.runRoutine(office, a.slug, r.id)}>{'Lanzar ahora'}</button>
                <span className="chip x" onClick={() => { if (confirm(`¿Eliminar la rutina «${r.label}»?`)) save({ ...a, routines: a.routines.filter((x) => x.id !== r.id) }) }}>{'eliminar'}</span>
              </div>
            </div>
            {editing === r.id && (
              <div style={{ marginTop: 8 }}>
                <textarea value={promptText} style={{ minHeight: 180 }} onChange={(e) => setPromptText(e.target.value)} placeholder="Lo que el agente debe hacer en cada ejecución…" />
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="primary" onClick={() => saveRoutine(r)}>{'Guardar las instrucciones'}</button>
                  <span className="hint">routines/{r.promptFile}</span>
                </div>
              </div>
            )}
          </div>
        ))}
        <button onClick={addRoutine}>{'+ Rutina'}</button>
      </div>

      <h4 style={{ margin: '18px 0 6px' }}>{'Personalidad y misión (CLAUDE.md)'}</h4>
      {editMd
        ? <>
            <textarea value={claudeMd} style={{ minHeight: 260 }} onChange={(e) => setClaudeMd(e.target.value)} />
            <div className="row" style={{ marginTop: 6 }}>
              <button className="primary" onClick={() => window.api.writeClaudeMd(office, a.slug, claudeMd).then(() => setEditMd(false))}>{'Guardar'}</button>
              <button onClick={() => setEditMd(false)}>{'Cancelar'}</button>
            </div>
          </>
        : <>
            <pre className="md" style={{ maxHeight: 220, overflow: 'auto', background: 'var(--bg)', padding: 10, borderRadius: 8 }}>{claudeMd}</pre>
            <button onClick={() => setEditMd(true)}>{'Editar'}</button>
          </>}

      <div style={{ marginTop: 24, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <button className="danger" onClick={() => { if (confirm(`¿Despedir a ${a.name}? Su carpeta se archiva en agents-archive/, no se borra nada.`)) window.api.deleteAgent(office, a.slug).then(onChanged) }}>Despedir a {a.name}</button>
      </div>
    </div>
  )
}
