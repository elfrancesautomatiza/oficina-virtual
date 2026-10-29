// Types partagés entre le process main (Electron) et le renderer (React).

export type PermissionMode = 'acceptEdits' | 'dontAsk' | 'bypassPermissions' | 'plan'

export interface AvatarSpec {
  seed: number
  skin: string
  hair: string
  hairStyle: 'short' | 'long' | 'bun' | 'curly' | 'bald' | 'mohawk' | 'bob'
  shirt: string
  glasses: boolean
  beard: boolean
  earrings: boolean
  gender: 'f' | 'm'
  /** Forme des yeux (facultatif) : 'almond' pour des yeux en amande. */
  eyes?: 'round' | 'almond'
  /** Couleur de l'iris (facultatif). */
  iris?: string
}

export interface Routine {
  id: string
  label: string
  /** Heure "HH:MM" dans le fuseau `tz` (ou l'heure du Mac si absent) */
  time: string
  /** Fuseau IANA, ex. "Europe/Paris", "America/Bogota". Vide = fuseau du Mac. */
  tz?: string
  /** Jours actifs, 0 = dimanche ... 6 = samedi. Vide = tous les jours. */
  days: number[]
  /** Jours du mois (1-31) : la routine ne part que ces jours-là (en-tête « dates: 1,15 »). Vide = tous. */
  monthDays?: number[]
  /** Nom du fichier prompt dans agents/<slug>/routines/ */
  promptFile: string
  enabled: boolean
  /** Si vrai, un rapport est écrit dans reports/ et condensé s'il y en a des non lus. */
  writesReport: boolean
  /** Nombre max de tours Claude pour cette routine (en-tête « tours: »), 60 par défaut */
  maxTurns?: number
  /** 'agent' = créée par l'agent lui-même (fichier routines/*.md avec en-tête) */
  source?: 'user' | 'agent'
  /** mtime du fichier au dernier alignement fichier ↔ agent.json */
  syncedAt?: number
  lastRun?: string
  lastStatus?: 'ok' | 'error' | 'running'
}

export interface AgentConfig {
  slug: string
  name: string
  role: string
  /** Phrase courte affichée sous le nom */
  tagline: string
  /** Métier court affiché sous le prénom dans le bureau (ex. « Montage »). Par défaut : le rôle. */
  job?: string
  avatar: AvatarSpec
  /** Position sur le bureau (colonne, rangée) */
  desk: { col: number; row: number }
  /** Dossiers auxquels l'agent a accès (passés en --add-dir). */
  folders: string[]
  /** Outils autorisés en mode chat (format Claude Code, ex. "WebSearch", "Bash(git *)") */
  allowedTools: string[]
  disallowedTools: string[]
  permissionMode: PermissionMode
  routinePermissionMode: PermissionMode
  model?: string
  /** Modèle en mode vocal (par défaut : sonnet, plus rapide) */
  voiceModel?: string
  /** Connecteurs MCP (format .mcp.json : { nom: { type:'http', url } | { command, args } }) */
  mcpServers?: Record<string, Record<string, unknown>>
  /** Connecteurs déjà branchés sur le compte claude.ai (ex. "Canva", "Gmail") que l'agent a le droit d'utiliser */
  claudeAiConnectors?: string[]
  /** Pilotage de Chrome via l'extension Claude in Chrome (--chrome) */
  chrome?: boolean
  routines: Routine[]
  createdAt: string
  /** Couleur d'accent de l'agent dans l'UI */
  color: string
  /** Toujours en haut de la messagerie */
  pinned?: boolean
}

export interface DecoItem { t: string; x: number; z: number; r: number }
/** Disposition 3D d'un bureau (offices/<office>/layout.json) */
export interface OfficeLayout { w: number; d: number; agents: Record<string, { x: number; z: number; r: number }>; decos: DecoItem[] | null }
/** Accès d'un agent (agents/<slug>/access.json) — jamais de secret dedans, le secret est dans le Trousseau. */
export interface AccessEntry { id: string; name: string; kind: 'api' | 'login'; env: string; url?: string; user?: string; note?: string; requestedBy?: 'agent' | 'owner'; updatedAt?: string }
export interface QuickStep { key: string; label: string; options: string[]; free?: string }
/** Bouton rapide d'un agent (agents/<slug>/actions.json) */
export interface QuickAction { id: string; label: string; hint?: string; steps: QuickStep[]; template: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
  at: string
  meta?: Record<string, unknown>
}

export interface AgentSession {
  sessionId: string | null
  messages: ChatMessage[]
  /** Dernière fois que tu as ouvert la conversation */
  lastSeenAt?: string
}

export interface Report {
  office: string
  agentSlug: string
  file: string
  date: string
  title: string
  read: boolean
  condensedFrom?: number
}

export interface MeetingTurn {
  agentSlug: string
  agentName: string
  round: number
  text: string
}

export interface Meeting {
  id: string
  topic: string
  participants: string[]
  startedAt: string
  endedAt?: string
  turns: MeetingTurn[]
  summary?: string
  status: 'running' | 'done' | 'error'
}

export interface OfficeMeta {
  slug: string
  name: string
  owner: string
  color: string
  createdAt: string
  /** Bureau invisible dans la vue des bureaux : ses agents n'apparaissent que dans la messagerie */
  hidden?: boolean
}

/** Une ligne de la messagerie (un agent) */
export interface ConversationSummary {
  office: string
  officeName: string
  officeColor: string
  officeHidden: boolean
  slug: string
  name: string
  role: string
  avatar: AvatarSpec
  color: string
  pinned: boolean
  lastAt: string
  preview: string
  /** D'où vient le dernier élément */
  previewFrom: 'agent' | 'moi' | 'question' | 'info' | 'rapport' | 'systeme' | ''
  /** Éléments non lus (questions, infos, rapports, messages de l'agent depuis la dernière ouverture) */
  unread: number
  /** Marqué « non lu » à la main */
  manualUnread: boolean
  /** Une question attend une réponse */
  question: boolean
  /** Dernière ouverture de la conversation (pour se placer sur le premier message non lu) */
  seenAt: string
}

/** Un élément du fil d'une conversation (messages + boîte de réception + rapports, dans l'ordre) */
export interface ThreadItem {
  id: string
  kind: 'user' | 'assistant' | 'system' | 'tool' | 'question' | 'info' | 'report'
  text: string
  title?: string
  file?: string
  at: string
  read?: boolean
}

export interface OfficeState {
  slug: string
  companyName: string
  owner: string
  color: string
  agents: AgentConfig[]
}

export type InboxKind = 'question' | 'info'

export interface InboxItem {
  office: string
  agentSlug: string
  file: string
  kind: InboxKind
  title: string
  at: string
  read: boolean
}

/** Ce que l'agent a à te dire : sert aux pastilles. */
export interface AgentAlerts {
  inboxQuestions: number
  inboxInfos: number
  unreadReports: number
  /** Dernier message de l'agent est une question que tu n'as pas encore vue */
  pendingQuestion: boolean
  total: number
}

export interface VoiceStatus {
  ok: boolean
  ffmpeg: boolean
  whisper: boolean
  model: boolean
  hint?: string
}

export interface FoundPath { raw: string; abs: string; isDir: boolean; name: string; editable: boolean }

export interface RunnerEvent {
  office: string
  agentSlug: string
  kind: 'start' | 'text' | 'tool' | 'result' | 'error' | 'end'
  text?: string
  sessionId?: string
  costUsd?: number
  durationMs?: number
}

export interface NewAgentInput {
  name: string
  role: string
  tagline: string
  mission: string
  folders: string[]
  gender: 'f' | 'm'
  allowWeb: boolean
  allowBash: boolean
}

// Canal IPC main <-> renderer
export interface Api {
  listOffices(): Promise<OfficeMeta[]>
  createOffice(name: string, owner: string, color: string): Promise<OfficeMeta>
  archiveOffice(office: string): Promise<void>
  getOffice(office: string): Promise<OfficeState>
  getAlerts(office: string): Promise<Record<string, AgentAlerts>>
  getAllAlerts(): Promise<Record<string, number>>
  getAgent(office: string, slug: string): Promise<AgentConfig | null>
  getSession(office: string, slug: string): Promise<AgentSession>
  markSeen(office: string, slug: string): Promise<void>
  send(office: string, slug: string, text: string, opts?: { voice?: boolean }): Promise<void>
  stop(office: string, slug: string): Promise<void>
  resetSession(office: string, slug: string): Promise<void>
  createAgent(office: string, input: NewAgentInput): Promise<AgentConfig>
  updateAgent(office: string, agent: AgentConfig): Promise<AgentConfig>
  /** Applique seulement les champs modifiés sur la fiche la plus récente du disque. */
  patchAgent(office: string, slug: string, changes: Record<string, { prev: unknown; next: unknown }>): Promise<AgentConfig>
  deleteAgent(office: string, slug: string): Promise<void>
  getLayout(office: string): Promise<OfficeLayout | null>
  saveLayout(office: string, layout: OfficeLayout): Promise<void>
  listAccess(office: string, slug: string): Promise<Array<AccessEntry & { ready: boolean }>>
  saveAccess(office: string, slug: string, entry: Partial<AccessEntry> & { name: string }, secret?: string): Promise<void>
  removeAccess(office: string, slug: string, id: string): Promise<void>
  openUrl(url: string): Promise<void>
  getActions(office: string, slug: string): Promise<QuickAction[]>
  saveActions(office: string, slug: string, list: QuickAction[]): Promise<void>
  readMemory(office: string, slug: string): Promise<string>
  readClaudeMd(office: string, slug: string): Promise<string>
  writeClaudeMd(office: string, slug: string, content: string): Promise<void>
  runRoutine(office: string, slug: string, routineId: string): Promise<void>
  readRoutine(office: string, slug: string, promptFile: string): Promise<string>
  writeRoutine(office: string, slug: string, promptFile: string, content: string): Promise<void>
  listReports(office: string): Promise<Report[]>
  readReport(office: string, slug: string, file: string): Promise<string>
  markReportRead(office: string, slug: string, file: string): Promise<void>
  listInbox(office: string, slug: string): Promise<InboxItem[]>
  readInbox(office: string, slug: string, file: string): Promise<string>
  markInboxRead(office: string, slug: string, file: string): Promise<void>
  startMeeting(office: string, topic: string, participants: string[]): Promise<string>
  getMeeting(office: string, id: string): Promise<Meeting | null>
  listMeetings(office: string): Promise<Meeting[]>
  listSkills(office: string, slug: string): Promise<{ own: string[]; global: string[]; dir: string }>
  pickFolder(): Promise<string | null>
  openPath(path: string): Promise<void>
  /** Chemins cités dans un message et qui existent vraiment. */
  findPaths(office: string, slug: string, text: string): Promise<FoundPath[]>
  revealPath(abs: string): Promise<void>
  /** Ouvre un Terminal dans le dossier de l'agent pour autoriser ses connecteurs MCP. */
  mcpAuth(office: string, slug: string): Promise<void>
  openFile(abs: string): Promise<boolean>
  checkClaude(): Promise<{ ok: boolean; version?: string; error?: string }>
  checkVoice(): Promise<VoiceStatus>
  installVoice(): Promise<void>
  /** Demande (ou vérifie) l'accès micro macOS. */
  askMic(): Promise<boolean>
  onVoiceInstall(cb: (ev: { line?: string; done?: boolean; ok?: boolean; status?: VoiceStatus }) => void): () => void
  /** Lit un texte à voix haute (macOS `say`). Résout quand la lecture est finie. */
  speak(text: string, voice?: string): Promise<void>
  openVoiceSettings(): Promise<void>
  stopSpeaking(): Promise<void>
  listVoices(): Promise<string[]>
  transcribe(office: string, slug: string, audio: Uint8Array, mime: string): Promise<{ text: string; error?: string }>
  saveImage(office: string, slug: string, data: Uint8Array, mime: string): Promise<string>
  readImage(office: string, slug: string, rel: string): Promise<string | null>
  onRunner(cb: (ev: RunnerEvent) => void): () => void
  onMeeting(cb: (m: Meeting) => void): () => void
  onRoutine(cb: (ev: { office: string; slug: string; routineId: string; status: string }) => void): () => void
  onAlerts(cb: () => void): () => void
  listConversations(): Promise<ConversationSummary[]>
  getThread(office: string, slug: string, limit?: number): Promise<ThreadItem[]>
  /** Ouvre la conversation : tout est lu (messages, questions, infos, rapports) */
  markConversationRead(office: string, slug: string): Promise<void>
  setConversationUnread(office: string, slug: string, unread: boolean): Promise<void>
}

/** Métier court d'un agent pour les étiquettes du bureau. */
export const jobOf = (a: { job?: string; role: string }): string => (a.job?.trim() || a.role.split(/\s+[–-]\s+/)[0]).slice(0, 32)
