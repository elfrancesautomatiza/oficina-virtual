// Réunion d'équipe : les agents échangent réellement entre eux pendant deux tours,
// puis chacun note ce qu'il retient dans sa propre mémoire (memory/meetings/).
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { Meeting, MeetingTurn, AgentConfig } from '../shared/types'
import { runOnce } from './claude-runner'
import { PROTECTED_RULES } from './routine-sync'
import { agentDir, loadOffice, meetingsDir, readJson, writeJson, resolveFolders, mcpFor } from './store'

export const meetingEvents = new EventEmitter()
const runningMeetings = new Set<string>()
export const meetingsRunning = (): number => runningMeetings.size

const meetingFile = (o: string, id: string): string => path.join(meetingsDir(o), `${id}.json`)

export function listMeetings(o: string): Meeting[] {
  if (!fs.existsSync(meetingsDir(o))) return []
  return fs.readdirSync(meetingsDir(o)).filter((f) => f.endsWith('.json'))
    .map((f) => readJson<Meeting | null>(path.join(meetingsDir(o), f), null))
    .filter((m): m is Meeting => !!m)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
}
export function getMeeting(o: string, id: string): Meeting | null {
  return readJson<Meeting | null>(meetingFile(o, id), null)
}

function save(o: string, m: Meeting): void {
  writeJson(meetingFile(o, m.id), m)
  meetingEvents.emit('meeting', { ...m, office: o })
}

const stamp = (): string => new Date().toISOString().slice(0, 10)

export async function startMeeting(o: string, topic: string, participantSlugs: string[]): Promise<string> {
  const office = loadOffice(o)
  const agents = office.agents.filter((a) => participantSlugs.includes(a.slug))
  if (agents.length < 2) throw new Error('Una reunión necesita al menos dos agentes.')
  const m: Meeting = {
    id: `${stamp()}-${randomUUID().slice(0, 8)}`,
    topic, participants: agents.map((a) => a.slug),
    startedAt: new Date().toISOString(), turns: [], status: 'running'
  }
  save(o, m)
  runningMeetings.add(m.id)
  runMeeting(o, m, agents, office.owner).catch((e) => {
    m.status = 'error'; m.summary = (e as Error).message; save(o, m)
  }).finally(() => runningMeetings.delete(m.id))
  return m.id
}

const roster = (agents: AgentConfig[]): string =>
  agents.map((a) => `- ${a.name} (${a.role})`).join('\n')

async function speak(o: string, a: AgentConfig, prompt: string, m: Meeting, round: number): Promise<MeetingTurn> {
  const res = await runOnce({
    cwd: agentDir(o, a.slug),
    prompt,
    noPersist: true,
    addDirs: resolveFolders(o, a),
    allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', ...mcpFor(o, a).tools],
    mcpConfig: mcpFor(o, a).mcpConfig,
    strictMcp: mcpFor(o, a).strictMcp,
    chrome: false,
    disallowedTools: PROTECTED_RULES,
    permissionMode: 'dontAsk',
    maxTurns: 12,
    model: a.model,
    appendSystemPrompt: `Participas en una reunión de equipo de ${m.participants.length} agentes. Habla en tu nombre (${a.name}), en primera persona, en español (salvo que tu jefe te escriba en otro idioma), 150 palabras como máximo, sin fórmulas de cortesía. Ve a lo esencial: hechos, cifras, pedidos concretos.`
  })
  const turn: MeetingTurn = { agentSlug: a.slug, agentName: a.name, round, text: res.isError ? `(error: ${res.errorText ?? 'desconocido'})` : res.text }
  m.turns.push(turn)
  save(o, m)
  return turn
}

async function runMeeting(o: string, m: Meeting, agents: AgentConfig[], owner: string): Promise<void> {
  // Tour 1 : chacun expose ce qu'il sait d'utile et ce dont il a besoin des autres.
  await Promise.all(agents.map((a) => speak(o, a, `# Reunión de equipo — ronda 1
Tema definido por ${owner}: **${m.topic}**

Participantes:
${roster(agents)}

Lee tu memoria (memory/MEMORY.md) y tus últimos informes (reports/) si te sirve.
Responde en 150 palabras máx.: (1) lo que sabes que sirve para este tema, con cifras si las tienes; (2) lo que propones hacer; (3) la información o la ayuda precisa que le pides a otro participante, nombrándolo.`, m, 1)))

  // Tour 2 : chacun répond aux autres et s'engage.
  const round1 = m.turns.filter((t) => t.round === 1)
  await Promise.all(agents.map((a) => {
    const others = round1.filter((t) => t.agentSlug !== a.slug).map((t) => `### ${t.agentName}\n${t.text}`).join('\n\n')
    return speak(o, a, `# Reunión de equipo — ronda 2
Tema: **${m.topic}**

Esto es lo que dijeron los demás en la ronda 1:

${others}

Responde en 150 palabras máx.: (1) responde a los pedidos que te hicieron, con la información exacta si la tienes; (2) lo que cambias en tu plan gracias a lo que escuchaste; (3) tu compromiso concreto (qué, cuándo).

Después, OBLIGATORIO: escribe un acta personal en \`memory/meetings/${m.id}.md\` (crea la carpeta) con lo que te llevas, la información recibida de los demás y tus compromisos. Agrega también una línea en memory/MEMORY.md que apunte a ese archivo.`, m, 2)
  }))

  // Synthèse : par le CEO s'il est là, sinon par le premier participant.
  const chair = agents.find((a) => a.slug === 'ceo') ?? agents[0]
  const transcript = m.turns.map((t) => `## ${t.agentName} (ronda ${t.round})\n${t.text}`).join('\n\n')
  const res = await runOnce({
    cwd: agentDir(o, chair.slug),
    prompt: `Esta es la transcripción completa de una reunión de equipo sobre «${m.topic}»:\n\n${transcript}\n\nRedacta para ${owner} un resumen de 12 líneas máx., en español (salvo que la reunión se haya hecho en otro idioma): decisiones, quién hace qué y cuándo, puntos en desacuerdo, decisiones que esperan a ${owner}. Sin introducción.`,
    noPersist: true, permissionMode: 'dontAsk', allowedTools: ['Read'], maxTurns: 3, model: chair.model
  })
  m.summary = res.isError ? `(no se pudo hacer el resumen: ${res.errorText})` : res.text
  m.status = 'done'
  m.endedAt = new Date().toISOString()
  save(o, m)
  fs.writeFileSync(path.join(meetingsDir(o), `${m.id}.md`), `# Reunión — ${m.topic}\n\n${m.startedAt}\n\n## Resumen\n${m.summary}\n\n## Transcripción\n${transcript}\n`)
}
