// Monde 3D voxel de l'Oficina Virtual : campus de bureaux, postes animés, décorations, réunions.
// Impératif (Three.js) ; le composant React Office3D ne fait que lui passer les données.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { jobOf, type AgentConfig, type DecoItem, type OfficeLayout } from '@shared/types'

export type AgentState = 'work' | 'idle' | 'question' | 'report'
export interface OfficeData { slug: string; name: string; color: string; agents: AgentConfig[]; layout: OfficeLayout | null }
export interface WorldCallbacks {
  onAgentClick: (office: string, slug: string) => void
  onOfficeFocus: (office: string | null) => void
  onLayoutChange: (office: string, layout: OfficeLayout) => void
  onToast: (msg: string) => void
  /** objet sélectionné en mode aménagement (null = rien) */
  onSelect?: (label: string | null) => void
  /** un objet vient d'être posé : on quitte le mode « poser » */
  onPlaced?: () => void
}
export const DECOS: Array<{ id: string; label: string }> = [
  { id: 'plant', label: 'Planta' }, { id: 'bigplant', label: 'Planta grande' }, { id: 'board', label: 'Pizarra' },
  { id: 'coffee', label: 'Cafetera' }, { id: 'shelf', label: 'Estantería' }, { id: 'sofa', label: 'Sofá' },
  { id: 'statue', label: 'Estatua búho' }, { id: 'rug', label: 'Alfombra' }, { id: 'lamp', label: 'Lámpara' }, { id: 'water', label: 'Dispensador de agua' }
]

const GAP = 6
type V3 = THREE.Vector3

interface Room { o: OfficeData; x: number; w: number; d: number; group: THREE.Group; meet: { x: number; z: number }; light: THREE.PointLight; kpi?: THREE.CanvasTexture }
interface Station {
  key: string; office: string; a: AgentConfig; st: THREE.Group; body: THREE.Group; torso: THREE.Group; head: THREE.Group
  armL: THREE.Group; armR: THREE.Group; mug: THREE.Mesh; bang: THREE.Sprite; paper: THREE.Sprite; tex: THREE.CanvasTexture
  phase: number; state: AgentState; busyText?: string; anim: { p: number; from: V3; to: V3 } | null; inMeeting: boolean
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d') as CanvasRenderingContext2D; draw(g, w, h)
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace
  return t
}
const ctx = (t: THREE.CanvasTexture): { g: CanvasRenderingContext2D; c: HTMLCanvasElement } => { const c = t.image as HTMLCanvasElement; return { c, g: c.getContext('2d') as CanvasRenderingContext2D } }

export class World {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400)
  private controls: OrbitControls
  private sun: THREE.DirectionalLight
  private mats = new Map<string, THREE.MeshLambertMaterial>()
  private rooms = new Map<string, Room>()
  private stations = new Map<string, Station>()
  private decos: THREE.Group[] = []
  private pickables: THREE.Object3D[] = []
  private groundG: THREE.Group | null = null
  private tagEls = new Map<string, HTMLDivElement>()
  private roomTagEls = new Map<string, HTMLDivElement>()
  private camAnim: { p: number; t0: V3; t1: V3; z0: number; z1: number; off: V3 } | null = null
  private raf = 0
  private data: OfficeData[] = []
  private signature = ''
  view: string = 'campus'
  editMode = false
  placing: string | null = null
  private selectedDeco: THREE.Group | null = null
  private selBox: THREE.BoxHelper | null = null
  private select(d: THREE.Group | null): void {
    this.selectedDeco = d
    if (this.selBox) { this.scene.remove(this.selBox); this.selBox.geometry.dispose(); this.selBox = null }
    if (d) { this.selBox = new THREE.BoxHelper(d, 0xffd166); this.scene.add(this.selBox) }
    this.cb.onSelect?.(d ? (DECOS.find((x) => x.id === d.userData.decoType)?.label ?? 'Objeto') : null)
  }
  clearSelection(): void { this.select(null) }
  private dragging: { kind: 'agent'; s: Station } | { kind: 'deco'; d: THREE.Group } | null = null
  private downAt: { x: number; y: number } | null = null
  private meeting: { office: string; ids: string[] } | null = null
  private ray = new THREE.Raycaster()
  private mouse = new THREE.Vector2()
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private ro: ResizeObserver
  private panelWidth = 0

  constructor(private canvas: HTMLCanvasElement, private tags: HTMLDivElement, private cb: WorldCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene.background = new THREE.Color(0x0a0f2a)
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.12, minPolarAngle: 0.45, maxPolarAngle: 1.15, minZoom: 0.12, maxZoom: 5, zoomSpeed: 1.6, screenSpacePanning: true })
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2140, 2.2))
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4)
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048)
    this.scene.add(this.sun); this.scene.add(this.sun.target)
    this.camera.position.set(40, 40, 40)
    this.ro = new ResizeObserver(() => { this.resize(); this.refit(true) })
    this.ro.observe(canvas)
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    this.resize()
    this.raf = requestAnimationFrame(this.animate)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.controls.dispose(); this.renderer.dispose()
    this.canvas.removeEventListener('pointerdown', this.onDown); this.canvas.removeEventListener('pointermove', this.onMove); this.canvas.removeEventListener('pointerup', this.onUp)
    this.tags.innerHTML = ''
  }

  /* ---------- matériaux / blocs ---------- */
  private M(c: number | string, extra?: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
    const k = String(c) + (extra ? JSON.stringify(extra) : '')
    let m = this.mats.get(k)
    if (!m) { m = new THREE.MeshLambertMaterial({ color: c, ...(extra ?? {}) }); this.mats.set(k, m) }
    return m
  }
  private box(w: number, h: number, d: number, c: number | string | THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), c instanceof THREE.Material ? c : this.M(c))
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
  }

  /* ---------- données ---------- */
  setOffices(list: OfficeData[]): void {
    const sig = JSON.stringify(list.map((o) => [o.slug, o.name, o.color, o.layout, o.agents.map((a) => [a.slug, a.name, a.avatar, a.color, a.desk])]))
    this.data = list
    if (sig === this.signature) return
    const first = this.signature === ''
    this.signature = sig
    this.build()
    if (first) this.focusCampus(true)
  }

  setStates(states: Record<string, { state: AgentState; busyText?: string }>): void {
    for (const s of this.stations.values()) {
      const v = states[s.key]
      if (!s.inMeeting) s.state = v?.state ?? 'idle'
      s.busyText = v?.busyText
    }
  }

  setMeeting(office: string | null, ids: string[]): void {
    const same = this.meeting && office === this.meeting.office && ids.join() === this.meeting.ids.join()
    if (same || (!office && !this.meeting)) return
    for (const s of this.stations.values()) if (s.inMeeting) { s.anim = { p: 0, from: s.body.position.clone(), to: new THREE.Vector3(0, 0.56, 0.55) }; s.inMeeting = false }
    this.meeting = office ? { office, ids } : null
    if (!office) return
    const r = this.rooms.get(office); if (!r) return
    ids.forEach((id, i) => {
      const s = this.stations.get(`${office}/${id}`); if (!s) return
      const ang = (i / ids.length) * Math.PI * 2 + Math.PI / 2
      const seat = new THREE.Vector3(r.x + r.meet.x + Math.cos(ang) * 1.45, 0, r.meet.z + Math.sin(ang) * 1.45)
      const local = s.st.worldToLocal(seat.clone()); local.y = 0.56
      s.anim = { p: 0, from: s.body.position.clone(), to: local }; s.inMeeting = true; s.state = 'work'
    })
  }

  setPanelWidth(px: number): void { if (px !== this.panelWidth) { this.panelWidth = px; this.refit(true) } }

  /* ---------- construction ---------- */
  private defaultLayout(o: OfficeData): OfficeLayout {
    const maxCol = Math.max(0, ...o.agents.map((a) => a.desk.col)), maxRow = Math.max(0, ...o.agents.map((a) => a.desk.row))
    return { w: Math.max(12, 3 * (maxCol + 1) + 4), d: Math.max(10, 3 * (maxRow + 1) + 5), agents: {}, decos: null }
  }
  private layoutOf(o: OfficeData): OfficeLayout { return o.layout ?? this.defaultLayout(o) }
  private agentPos(o: OfficeData, a: AgentConfig): { x: number; z: number; r: number } {
    const l = this.layoutOf(o).agents[a.slug]
    return l ?? { x: 2.5 + a.desk.col * 3, z: 2.5 + a.desk.row * 3, r: 0 }
  }
  private defaultDecos(w: number, d: number): DecoItem[] {
    const list: DecoItem[] = [
      { t: 'plant', x: 0.8, z: 0.8, r: 0 }, { t: 'bigplant', x: w - 0.8, z: 0.8, r: 0 }, { t: 'board', x: 4, z: 0.35, r: 0 },
      { t: 'coffee', x: w - 3, z: 0.6, r: 0 }, { t: 'sofa', x: 2.6, z: d - 1.1, r: Math.PI }, { t: 'rug', x: 2.6, z: d - 2.7, r: 0 }, { t: 'water', x: w - 1.6, z: 0.6, r: 0 }
    ]
    if (w >= 14) list.push({ t: 'shelf', x: 7, z: 0.4, r: 0 }, { t: 'statue', x: 0.9, z: d / 2, r: 0 })
    return list
  }

  private build(): void {
    for (const r of this.rooms.values()) this.scene.remove(r.group)
    for (const s of this.stations.values()) this.scene.remove(s.st)
    for (const d of this.decos) this.scene.remove(d)
    this.rooms.clear(); this.stations.clear(); this.decos = []; this.pickables = []; this.select(null)
    let x = 0
    for (const o of this.data) { const l = this.layoutOf(o); this.buildRoom(o, x, l.w, l.d); x += l.w + GAP }
    this.buildGround()
    for (const o of this.data) {
      const r = this.rooms.get(o.slug) as Room
      const decos = this.layoutOf(o).decos ?? this.defaultDecos(r.w, r.d)
      decos.forEach((d) => this.placeDeco(o.slug, d.t, d.x, d.z, d.r))
      o.agents.forEach((a) => this.buildStation(o, a))
    }
    const maxX = this.maxX()
    this.sun.position.set(maxX / 2 + 10, 50, 25); this.sun.target.position.set(maxX / 2, 0, 5)
    const span = Math.max(maxX, 40)
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span * 0.7, bottom: -span * 0.7, near: 1, far: 160 })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.buildTags()
    if (this.meeting) { const m = this.meeting; this.meeting = null; this.setMeeting(m.office, m.ids) }
    if (this.view !== 'campus' && !this.rooms.has(this.view)) this.view = 'campus'
  }
  private maxX(): number { let m = 0; for (const r of this.rooms.values()) m = Math.max(m, r.x + r.w); return m }

  private buildGround(): void {
    if (this.groundG) this.scene.remove(this.groundG)
    const g = new THREE.Group(); this.groundG = g; this.scene.add(g)
    const maxX = this.maxX()
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(maxX + 200, 300), this.M(0x3b7a3f)); gm.rotation.x = -Math.PI / 2; gm.position.set(maxX / 2, -0.26, 5); gm.receiveShadow = true; g.add(gm)
    let seed = 7; const rnd = (): number => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    const rooms = [...this.rooms.values()]
    for (let i = 0; i < 260; i++) {
      const gx = Math.round(-20 + rnd() * (maxX + 40)), gz = Math.round(-15 + rnd() * 45)
      if (rooms.some((r) => gx > r.x - 1.5 && gx < r.x + r.w + 1.5 && gz > -1.5 && gz < r.d + 1.5)) continue
      this.box(1, 0.1, 1, rnd() < 0.5 ? 0x356d38 : 0x428a46, gx, -0.2, gz, g)
    }
    for (let px = -2; px < maxX + 2; px++) this.box(1, 0.12, 2, 0x9a9a8f, px, -0.19, -2.5, g)
  }

  private buildRoom(o: OfficeData, x: number, w: number, d: number): void {
    const g = new THREE.Group(); g.position.set(x, 0, 0); this.scene.add(g)
    const accent = new THREE.Color(o.color)
    const f1 = new THREE.Color(0xc9a27a).lerp(accent, 0.18), f2 = f1.clone().multiplyScalar(0.9)
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) this.box(1, 0.25, 1, '#' + ((i + j) % 2 ? f1 : f2).getHexString(), i + 0.5, -0.125, j + 0.5, g)
    const wall = '#' + new THREE.Color(0xdcd6cc).lerp(accent, 0.08).getHexString()
    const win = this.M(0x9fd8ff, { emissive: 0x335577 })
    for (let i = 0; i < w; i++) for (let y = 0; y < 4; y++) { const isWin = (y === 1 || y === 2) && i % 4 === 2 && i < w - 1; this.box(1, 1, 0.4, isWin ? win : y === 0 ? 0x8a7a66 : wall, i + 0.5, y + 0.5, -0.2, g) }
    for (let j = 0; j < d; j++) for (let y = 0; y < 4; y++) { const isWin = (y === 1 || y === 2) && j % 4 === 2; this.box(0.4, 1, 1, isWin ? win : y === 0 ? 0x8a7a66 : wall, -0.2, y + 0.5, j + 0.5, g) }
    for (let i = 0; i < w; i++) this.box(1, 0.3, 0.2, 0x6b5b4a, i + 0.5, 0.15, d + 0.1, g)
    for (let j = 0; j < d; j++) this.box(0.2, 0.3, 1, 0x6b5b4a, w + 0.1, 0.15, j + 0.5, g)
    const sign = canvasTex(256, 64, (c, cw, ch) => { c.fillStyle = '#0a0f2a'; c.fillRect(0, 0, cw, ch); c.fillStyle = o.color; c.fillRect(0, ch - 8, cw, 8); c.fillStyle = '#fff'; c.font = 'bold 30px monospace'; c.textAlign = 'center'; c.fillText(o.name.toUpperCase().slice(0, 14), cw / 2, 40) })
    const s = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: sign })); s.position.set(Math.min(w / 2, w - 2.5), 3.4, 0.02); g.add(s)
    /* écran mural de stats */
    const kpi = canvasTex(256, 128, () => undefined)
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: kpi })); sc.position.set(0.02, 2.3, Math.min(4, d / 2)); sc.rotation.y = Math.PI / 2; g.add(sc)
    this.box(0.1, 1.4, 2.6, 0x1b1b1b, -0.02, 2.3, Math.min(4, d / 2), g)
    /* coin réunion */
    const mx = w - 2.6, mz = d - 2.6
    this.box(2, 0.18, 2, 0x6b4423, mx, 0.95, mz, g); this.box(0.3, 0.86, 0.3, 0x3b2a1a, mx, 0.45, mz, g)
    for (const [dx, dz] of [[-1.4, 0], [1.4, 0], [0, -1.4], [0, 1.4]]) this.box(0.55, 0.4, 0.55, 0x2e3a66, mx + dx, 0.2, mz + dz, g)
    const light = new THREE.PointLight(0x3ecfe0, 0, 7, 1); light.position.set(mx, 3, mz); g.add(light)
    this.rooms.set(o.slug, { o, x, w, d, group: g, meet: { x: mx, z: mz }, light, kpi })
  }

  private buildStation(o: OfficeData, a: AgentConfig): void {
    const r = this.rooms.get(o.slug) as Room
    const pos = this.agentPos(o, a)
    const st = new THREE.Group(); st.position.set(r.x + Math.min(Math.max(pos.x, 1), r.w - 1), 0, Math.min(Math.max(pos.z, 1), r.d - 1)); st.rotation.y = pos.r || 0; this.scene.add(st)
    const B = (w: number, h: number, d: number, c: number | string | THREE.Material, x: number, y: number, z: number, p: THREE.Object3D = st): THREE.Mesh => this.box(w, h, d, c, x, y, z, p)
    B(1.8, 0.12, 0.9, 0xc49a6c, 0, 0.82, -0.15)
    for (const [lx, lz] of [[-0.82, -0.52], [0.82, -0.52], [-0.82, 0.22], [0.82, 0.22]]) B(0.08, 0.8, 0.08, 0x7a5a3a, lx, 0.4, lz)
    const tex = canvasTex(64, 40, (c, w, h) => { c.fillStyle = '#05070f'; c.fillRect(0, 0, w, h) })
    B(0.9, 0.56, 0.06, 0x16161c, 0, 1.25, -0.45); B(0.08, 0.3, 0.08, 0x16161c, 0, 0.98, -0.45)
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.48), new THREE.MeshBasicMaterial({ map: tex })); scr.position.set(0, 1.25, -0.415); st.add(scr)
    B(0.6, 0.04, 0.2, 0x2a2a32, 0, 0.9, 0)
    B(0.7, 0.12, 0.7, 0x2d2d3a, 0, 0.5, 0.55); B(0.7, 0.7, 0.1, 0x2d2d3a, 0, 0.9, 0.92); B(0.1, 0.44, 0.1, 0x111111, 0, 0.25, 0.55)
    const av = a.avatar
    const shirt = av.shirt || a.color, skin = av.skin, hair = av.hair, pants = '#2b2f45'
    const body = new THREE.Group(); body.position.set(0, 0.56, 0.55); st.add(body)
    const torso = new THREE.Group(); body.add(torso)
    B(0.5, 0.6, 0.3, shirt, 0, 0.36, 0, torso)
    const head = new THREE.Group(); head.position.set(0, 0.9, 0); torso.add(head)
    B(0.42, 0.42, 0.42, skin, 0, 0, 0, head)
    if (av.hairStyle !== 'bald') {
      B(0.44, 0.14, 0.44, hair, 0, 0.2, 0, head); B(0.44, 0.3, 0.08, hair, 0, 0.06, 0.2, head)
      if (['long', 'bob', 'curly'].includes(av.hairStyle)) B(0.44, 0.36, 0.08, hair, 0, -0.02, 0.22, head)
      if (av.hairStyle === 'bun') B(0.18, 0.18, 0.18, hair, 0, 0.18, 0.28, head)
      if (av.hairStyle === 'mohawk') B(0.1, 0.16, 0.44, hair, 0, 0.32, 0, head)
    }
    B(0.06, 0.06, 0.02, '#111111', -0.1, 0.02, -0.215, head); B(0.06, 0.06, 0.02, '#111111', 0.1, 0.02, -0.215, head)
    if (av.glasses) B(0.36, 0.05, 0.02, '#222222', 0, 0.03, -0.222, head)
    if (av.beard) B(0.4, 0.14, 0.04, hair, 0, -0.16, -0.215, head)
    const arm = (sx: number): THREE.Group => { const g = new THREE.Group(); g.position.set(sx, 0.6, 0); torso.add(g); B(0.16, 0.5, 0.16, shirt, 0, -0.22, 0, g); B(0.15, 0.12, 0.15, skin, 0, -0.5, 0, g); return g }
    const armL = arm(-0.33), armR = arm(0.33)
    B(0.2, 0.16, 0.5, pants, -0.12, 0, -0.2, body); B(0.2, 0.16, 0.5, pants, 0.12, 0, -0.2, body)
    B(0.2, 0.5, 0.16, pants, -0.12, -0.25, -0.42, body); B(0.2, 0.5, 0.16, pants, 0.12, -0.25, -0.42, body)
    const mug = B(0.12, 0.14, 0.12, 0xffffff, 0, -0.5, -0.06, armR); mug.visible = false
    const sprite = (bg: string, draw: (c: CanvasRenderingContext2D) => void): THREE.Sprite => {
      const t = canvasTex(64, 64, (c) => { c.fillStyle = bg; c.beginPath(); c.arc(32, 32, 28, 0, 7); c.fill(); draw(c) })
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); sp.scale.set(0.55, 0.55, 1); sp.position.set(0, 2.35, 0.55); st.add(sp); return sp
    }
    const bang = sprite('#ffd166', (c) => { c.fillStyle = '#1a1300'; c.font = 'bold 46px monospace'; c.textAlign = 'center'; c.fillText('!', 32, 48) })
    const paper = sprite('#3ecfe0', (c) => { c.fillStyle = '#fff'; c.fillRect(20, 14, 24, 34); c.fillStyle = '#3ecfe0'; for (let i = 0; i < 4; i++) c.fillRect(24, 20 + i * 7, 16, 3) })
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.2, 1.9), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, 1.1, 0.1)
    hit.userData = { agent: a.slug, office: o.slug }; st.add(hit); this.pickables.push(hit)
    const key = `${o.slug}/${a.slug}`
    this.stations.set(key, { key, office: o.slug, a, st, body, torso, head, armL, armR, mug, bang, paper, tex, phase: Math.random() * 6, state: 'idle', anim: null, inMeeting: false })
  }

  private buildDeco(type: string): THREE.Group {
    const g = new THREE.Group()
    const P = (w: number, h: number, d: number, c: number | THREE.Material, x: number, y: number, z: number): THREE.Mesh => this.box(w, h, d, c, x, y, z, g)
    if (type === 'plant') { P(0.4, 0.35, 0.4, 0xb5643c, 0, 0.18, 0); P(0.5, 0.4, 0.5, 0x2f8f3a, 0, 0.55, 0); P(0.3, 0.3, 0.3, 0x3fae4b, 0, 0.85, 0) }
    if (type === 'bigplant') { P(0.6, 0.5, 0.6, 0x8a8a8a, 0, 0.25, 0); P(0.12, 0.8, 0.12, 0x6b4423, 0, 0.9, 0); P(0.8, 0.5, 0.8, 0x2f8f3a, 0, 1.45, 0); P(0.55, 0.45, 0.55, 0x3fae4b, 0, 1.85, 0); P(0.3, 0.3, 0.3, 0x4fc35b, 0.25, 1.25, 0.25) }
    if (type === 'board') {
      P(0.1, 1.6, 0.1, 0x555555, -0.9, 0.8, 0); P(0.1, 1.6, 0.1, 0x555555, 0.9, 0.8, 0); P(1.9, 1.1, 0.08, 0xdddddd, 0, 1.35, 0)
      const t = canvasTex(128, 72, (c, w, h) => { c.fillStyle = '#fafafa'; c.fillRect(0, 0, w, h); c.fillStyle = '#2e8bf0'; c.font = 'bold 12px monospace'; c.fillText('OBJETIVOS', 8, 16); c.fillStyle = '#e0534f'; c.fillRect(8, 26, 60, 5); c.fillStyle = '#3ee08f'; c.fillRect(8, 38, 90, 5); c.fillStyle = '#ffd166'; c.fillRect(8, 50, 40, 5) })
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1), new THREE.MeshBasicMaterial({ map: t })); m.position.set(0, 1.35, 0.05); g.add(m)
    }
    if (type === 'coffee') { P(0.9, 0.9, 0.6, 0x5a5a62, 0, 0.45, 0); P(0.5, 0.5, 0.1, 0x222222, 0, 1.05, -0.25); P(0.15, 0.15, 0.15, 0xffffff, 0, 0.98, 0.15); P(0.6, 0.08, 0.08, 0xff5a5f, 0, 1.25, 0.3) }
    if (type === 'shelf') { P(1.6, 2, 0.4, 0x7a5a3a, 0, 1, 0); const cols = [0xe0534f, 0x2e8bf0, 0xffd166, 0x3ee08f, 0x7a5cf5, 0xff7b9c]; [0.45, 1.05, 1.65].forEach((y, k) => { for (let i = 0; i < 6; i++) P(0.18, 0.42, 0.3, cols[(i + k * 2) % 6], -0.6 + i * 0.24, y, 0.03) }) }
    if (type === 'sofa') { P(2, 0.45, 0.9, 0x2e8bf0, 0, 0.25, 0); P(2, 0.6, 0.25, 0x2477c9, 0, 0.65, 0.35); P(0.25, 0.55, 0.9, 0x2477c9, -0.95, 0.45, 0); P(0.25, 0.55, 0.9, 0x2477c9, 0.95, 0.45, 0) }
    if (type === 'statue') { P(0.8, 0.5, 0.8, 0xcfcfcf, 0, 0.25, 0); P(0.5, 0.7, 0.45, 0xffc94a, 0, 0.85, 0); P(0.55, 0.35, 0.5, 0xffd86b, 0, 1.35, 0); P(0.12, 0.12, 0.04, 0x111111, -0.12, 1.4, -0.26); P(0.12, 0.12, 0.04, 0x111111, 0.12, 1.4, -0.26); P(0.08, 0.08, 0.06, 0xff8c42, 0, 1.3, -0.27) }
    if (type === 'rug') { P(2.4, 0.04, 1.6, 0x7a5cf5, 0, 0.02, 0); P(2, 0.05, 1.2, 0x9b84ff, 0, 0.03, 0) }
    if (type === 'lamp') { P(0.3, 0.08, 0.3, 0x222222, 0, 0.04, 0); P(0.06, 1.5, 0.06, 0x333333, 0, 0.8, 0); P(0.45, 0.3, 0.45, this.M(0xfff1c4, { emissive: 0x886a20 }), 0, 1.6, 0); const l = new THREE.PointLight(0xffd59a, 1.5, 4, 1); l.position.set(0, 1.5, 0); g.add(l) }
    if (type === 'water') { P(0.5, 0.9, 0.5, 0xeeeeee, 0, 0.45, 0); P(0.36, 0.5, 0.36, this.M(0x7fd3ff, { transparent: true, opacity: 0.7 }), 0, 1.15, 0) }
    g.userData.decoType = type; return g
  }
  private placeDeco(office: string, type: string, x: number, z: number, r = 0): THREE.Group {
    const room = this.rooms.get(office) as Room
    const d = this.buildDeco(type); d.position.set(room.x + x, 0, z); d.rotation.y = r; this.scene.add(d)
    d.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.userData.deco = d; this.pickables.push(m) } })
    d.userData.office = office; this.decos.push(d); return d
  }

  /* ---------- sauvegarde de la disposition ---------- */
  private emitLayout(office: string): void {
    const r = this.rooms.get(office); if (!r) return
    const agents: OfficeLayout['agents'] = {}
    for (const s of this.stations.values()) if (s.office === office) agents[s.a.slug] = { x: +(s.st.position.x - r.x).toFixed(2), z: +s.st.position.z.toFixed(2), r: s.st.rotation.y }
    const decos = this.decos.filter((d) => d.userData.office === office).map((d) => ({ t: d.userData.decoType as string, x: +(d.position.x - r.x).toFixed(2), z: +d.position.z.toFixed(2), r: d.rotation.y }))
    const layout: OfficeLayout = { w: r.w, d: r.d, agents, decos }
    const o = this.data.find((x) => x.slug === office); if (o) o.layout = layout
    this.cb.onLayoutChange(office, layout)
  }

  resizeOffice(dw: number, dd: number): void {
    if (this.view === 'campus') { this.cb.onToast('Primero entra en una oficina'); return }
    const r = this.rooms.get(this.view); if (!r) return
    let mw = 8, md = 8
    for (const s of this.stations.values()) if (s.office === r.o.slug) { mw = Math.max(mw, Math.ceil(s.st.position.x - r.x + 1.2)); md = Math.max(md, Math.ceil(s.st.position.z + 1.6)) }
    for (const d of this.decos) if (d.userData.office === r.o.slug) { mw = Math.max(mw, Math.ceil(d.position.x - r.x + 0.6)); md = Math.max(md, Math.ceil(d.position.z + 0.6)) }
    mw = Math.max(mw, 7); md = Math.max(md, 7)
    let nw = r.w + dw, nd = r.d + dd
    if (dw < 0 || dd < 0) { nw = Math.max(mw, r.w - 2); nd = Math.max(md, r.d - 2); if (nw === r.w && nd === r.d) { this.cb.onToast('No se puede reducir: hay puestos u objetos tocando el borde. Muévelos primero.'); return } }
    nw = Math.min(nw, 40); nd = Math.min(nd, 30)
    this.emitLayout(r.o.slug)
    const o = this.data.find((x) => x.slug === r.o.slug) as OfficeData
    o.layout = { ...(o.layout as OfficeLayout), w: nw, d: nd }
    this.cb.onLayoutChange(o.slug, o.layout)
    this.signature = ''; this.setOffices(this.data)
    this.focusOffice(o.slug)
    this.cb.onToast(`${o.name}: ${nw} × ${nd} casillas`)
  }
  sizeOf(office: string): { w: number; d: number } | null { const r = this.rooms.get(office); return r ? { w: r.w, d: r.d } : null }
  rotateSelected(): void { if (this.selectedDeco) { this.selectedDeco.rotation.y += Math.PI / 2; this.selBox?.update(); this.emitLayout(this.selectedDeco.userData.office) } }
  deleteSelected(): void {
    const d = this.selectedDeco; if (!d) return
    this.scene.remove(d); this.decos.splice(this.decos.indexOf(d), 1)
    this.pickables = this.pickables.filter((p) => p.userData.deco !== d); this.select(null)
    this.emitLayout(d.userData.office); this.cb.onToast('Objeto quitado')
  }

  /* ---------- caméra ---------- */
  private resize(): void {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1, a = w / h, s = 14
    Object.assign(this.camera, { left: -s * a, right: s * a, top: s, bottom: -s }); this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }
  private fit(minx: number, maxx: number, minz: number, maxz: number): { c: V3; z: number } {
    const c = new THREE.Vector3((minx + maxx) / 2, 1.5, (minz + maxz) / 2)
    const inv = this.camera.quaternion.clone().invert(); let mx = 0, my = 0
    for (const x of [minx, maxx]) for (const y of [0, 4.5]) for (const z of [minz, maxz]) { const v = new THREE.Vector3(x, y, z).sub(c).applyQuaternion(inv); mx = Math.max(mx, Math.abs(v.x)); my = Math.max(my, Math.abs(v.y)) }
    const cw = this.canvas.clientWidth || 1, usable = Math.max(0.3, (cw - this.panelWidth) / cw)
    const z = Math.min((this.camera.right * usable) / mx, (this.camera.top * 0.86) / my) * 0.92
    const shift = this.panelWidth ? (this.camera.right / z) * (1 - usable) : 0
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    return { c: new THREE.Vector3(c.x, 0, c.z).add(right.multiplyScalar(shift)), z }
  }
  private flyTo(t: V3, z: number, instant = false): void {
    const off = this.camera.position.clone().sub(this.controls.target)
    if (instant) { this.controls.target.copy(t); this.camera.position.copy(t).add(off); this.camera.zoom = z; this.camera.updateProjectionMatrix(); this.camAnim = null; return }
    this.camAnim = { p: 0, t0: this.controls.target.clone(), t1: t.clone(), z0: this.camera.zoom, z1: z, off }
  }
  focusCampus(instant = false): void {
    if (!this.rooms.size) return
    this.view = 'campus'
    const maxD = Math.max(...[...this.rooms.values()].map((r) => r.d))
    if (instant) { this.camera.position.set(this.maxX() / 2 + 40, 40, 45); this.controls.target.set(this.maxX() / 2, 0, 5); this.camera.lookAt(this.controls.target); this.camera.updateMatrixWorld() }
    const f = this.fit(-1, this.maxX() + 1, -3, maxD + 1); this.flyTo(f.c, f.z, instant)
    this.cb.onOfficeFocus(null)
  }
  focusOffice(id: string, notify = true): void {
    const r = this.rooms.get(id); if (!r) return
    this.view = id
    const f = this.fit(r.x - 0.5, r.x + r.w + 0.5, -0.5, r.d + 0.5); this.flyTo(f.c, f.z)
    if (notify) this.cb.onOfficeFocus(id)
  }
  refit(instant = false): void { if (this.view === 'campus') this.focusCampus(instant); else this.focusOffice(this.view, false) }
  zoomBy(f: number): void { this.camAnim = null; this.camera.zoom = Math.max(this.controls.minZoom, Math.min(this.controls.maxZoom, this.camera.zoom * f)); this.camera.updateProjectionMatrix() }

  /* ---------- interaction ---------- */
  private setMouse(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect()
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.mouse, this.camera)
  }
  private roomAt(x: number, z: number): Room | undefined { return [...this.rooms.values()].find((r) => x >= r.x && x <= r.x + r.w && z >= 0 && z <= r.d) }
  private onDown = (e: PointerEvent): void => {
    this.setMouse(e); this.downAt = { x: e.clientX, y: e.clientY }
    if (!this.editMode) return
    // Un objet existant sous le curseur : on le sélectionne (même si un objet à poser est choisi dans la palette).
    const hit = this.ray.intersectObjects(this.pickables, false)[0]
    if (!hit && this.placing) {
      const p = new THREE.Vector3(); if (!this.ray.ray.intersectPlane(this.floorPlane, p)) return
      const r = this.roomAt(p.x, p.z); if (!r) return
      const d = this.placeDeco(r.o.slug, this.placing, Math.round((p.x - r.x) * 2) / 2, Math.round(p.z * 2) / 2)
      this.cb.onToast(`Agregado: ${DECOS.find((x) => x.id === this.placing)?.label}`)
      this.placing = null; this.cb.onPlaced?.()
      this.select(d); this.emitLayout(r.o.slug)
      return
    }
    if (!hit) { this.select(null); return }
    if (hit.object.userData.agent) { this.select(null); const s = this.stations.get(`${hit.object.userData.office}/${hit.object.userData.agent}`); if (s) this.dragging = { kind: 'agent', s } }
    else if (hit.object.userData.deco) { this.dragging = { kind: 'deco', d: hit.object.userData.deco }; this.select(hit.object.userData.deco) }
    if (this.dragging) { this.controls.enabled = false; this.canvas.setPointerCapture(e.pointerId) }
  }
  private onMove = (e: PointerEvent): void => {
    this.setMouse(e)
    if (!this.dragging) { if (!this.editMode) { const h = this.ray.intersectObjects(this.pickables, false)[0]; this.canvas.style.cursor = h && h.object.userData.agent ? 'pointer' : '' } return }
    const p = new THREE.Vector3(); if (!this.ray.ray.intersectPlane(this.floorPlane, p)) return
    if (this.dragging.kind === 'agent') {
      const s = this.dragging.s, r = this.rooms.get(s.office) as Room
      s.st.position.set(r.x + Math.max(1, Math.min(r.w - 1, Math.floor(p.x - r.x) + 0.5)), 0, Math.max(1, Math.min(r.d - 1, Math.floor(p.z) + 0.5)))
    } else {
      const d = this.dragging.d, r = this.rooms.get(d.userData.office) as Room
      d.position.x = Math.max(r.x + 0.4, Math.min(r.x + r.w - 0.4, Math.round(p.x * 2) / 2)); d.position.z = Math.max(0.4, Math.min(r.d - 0.4, Math.round(p.z * 2) / 2)); this.selBox?.update()
    }
  }
  private onUp = (e: PointerEvent): void => {
    if (this.dragging) { const office = this.dragging.kind === 'agent' ? this.dragging.s.office : this.dragging.d.userData.office; this.dragging = null; this.controls.enabled = true; this.emitLayout(office); return }
    if (this.editMode || !this.downAt) return
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6) return
    this.setMouse(e)
    const hit = this.ray.intersectObjects(this.pickables, false)[0]
    if (hit && hit.object.userData.agent) { const o = hit.object.userData.office as string; if (this.view !== o) this.focusOffice(o); this.cb.onAgentClick(o, hit.object.userData.agent); return }
    if (this.view === 'campus') { const p = new THREE.Vector3(); if (this.ray.ray.intersectPlane(this.floorPlane, p)) { const r = this.roomAt(p.x, p.z); if (r) this.focusOffice(r.o.slug) } }
  }

  /* ---------- étiquettes ---------- */
  private buildTags(): void {
    this.tags.innerHTML = ''; this.tagEls.clear(); this.roomTagEls.clear()
    for (const s of this.stations.values()) { const d = document.createElement('div'); d.className = 'w3-tag'; this.tags.appendChild(d); this.tagEls.set(s.key, d) }
    for (const r of this.rooms.values()) { const d = document.createElement('div'); d.className = 'w3-tag w3-room'; d.textContent = r.o.name; d.onclick = () => this.focusOffice(r.o.slug); this.tags.appendChild(d); this.roomTagEls.set(r.o.slug, d) }
  }
  private updateTags(): void {
    const R = this.canvas.getBoundingClientRect(), T = this.tags.getBoundingClientRect()
    const showNames = this.camera.zoom > 1.1, v = new THREE.Vector3()
    for (const s of this.stations.values()) {
      const el = this.tagEls.get(s.key); if (!el) continue
      s.body.getWorldPosition(v); v.y += 1.75; v.project(this.camera)
      const job = jobOf(s.a), first = s.a.name.split(' ')[0]
      const label = `${first}|${job}|${s.busyText ?? ''}`
      if (el.dataset.k !== label) {
        el.dataset.k = label; el.textContent = ''
        const b = document.createElement('b'); b.textContent = first; el.appendChild(b)
        const j = document.createElement('span'); j.className = 'job'; j.textContent = job; el.appendChild(j)
        if (s.busyText) { const t = document.createElement('span'); t.className = 'act'; t.textContent = s.busyText; el.appendChild(t) }
      }
      el.classList.toggle('busy', !!s.busyText)
      el.hidden = !(showNames || s.busyText) || v.z > 1
      el.style.left = `${R.left - T.left + ((v.x + 1) / 2) * R.width}px`; el.style.top = `${R.top - T.top + ((1 - v.y) / 2) * R.height}px`
    }
    for (const r of this.rooms.values()) {
      const el = this.roomTagEls.get(r.o.slug); if (!el) continue
      v.set(r.x + r.w / 2, 4.6, r.d / 2).project(this.camera)
      el.hidden = this.view !== 'campus'
      el.style.left = `${R.left - T.left + ((v.x + 1) / 2) * R.width}px`; el.style.top = `${R.top - T.top + ((1 - v.y) / 2) * R.height}px`
    }
  }

  /* ---------- animation ---------- */
  private drawScreen(s: Station, t: number): void {
    const { g, c } = ctx(s.tex); const w = c.width, h = c.height
    if (s.state === 'work') {
      g.fillStyle = '#0b1a2c'; g.fillRect(0, 0, w, h); const off = Math.floor(t * 14 + s.phase * 10)
      for (let i = 0; i < 7; i++) { const len = 10 + ((i * 37 + off * 3 + Math.floor(s.phase * 7)) % 40); g.fillStyle = ['#3ecfe0', '#3ee08f', '#2e8bf0', '#ffd166'][(i + off) % 4]; g.fillRect(4, 4 + i * 5, Math.min(len, w - 8), 2) }
    } else if (s.state === 'question') { g.fillStyle = '#2c2408'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd166'; g.font = 'bold 22px monospace'; g.fillText('?', 26, 28) }
    else if (s.state === 'report') { g.fillStyle = '#08262c'; g.fillRect(0, 0, w, h); g.fillStyle = '#3ecfe0'; g.fillRect(16, 8, 32, 24); g.fillStyle = '#08262c'; for (let i = 0; i < 4; i++) g.fillRect(20, 12 + i * 5, 24, 2) }
    else { g.fillStyle = '#05070f'; g.fillRect(0, 0, w, h); g.fillStyle = '#1c2448'; g.fillRect(28, 18, 8, 3) }
    s.tex.needsUpdate = true
  }
  private drawKpi(r: Room, t: number): void {
    if (!r.kpi) return
    const { g, c } = ctx(r.kpi); const w = c.width
    const list = [...this.stations.values()].filter((s) => s.office === r.o.slug)
    const n = (st: AgentState): number => list.filter((s) => s.state === st).length
    g.fillStyle = '#0a0f2a'; g.fillRect(0, 0, w, c.height)
    g.fillStyle = '#3ecfe0'; g.font = 'bold 14px monospace'; g.fillText(`${r.o.name.toUpperCase().slice(0, 16)} · HOY`, 10, 20)
    const col = (x: number, v: string, color: string, lbl: string): void => { g.fillStyle = color; g.font = 'bold 30px monospace'; g.fillText(v, x, 60); g.fillStyle = '#a6b0d4'; g.font = '12px monospace'; g.fillText(lbl, x, 76) }
    col(10, `${n('work')}/${list.length}`, '#3ee08f', 'trabajando'); col(120, String(n('question')), '#ffd166', 'preguntas'); col(190, String(n('report')), '#3ecfe0', 'informes')
    for (let i = 0; i < 24; i++) { const v = Math.abs(Math.sin(i * 0.7 + Math.floor(t / 3) * 0.3)) * 30 + 6; g.fillStyle = i === 23 ? '#3ee08f' : '#2e8bf0'; g.fillRect(10 + i * 9.6, 120 - v, 6, v) }
    r.kpi.needsUpdate = true
  }
  private frame = 0
  private animate = (time: number): void => {
    const t = time / 1000; this.frame++
    for (const s of this.stations.values()) {
      const k = t * 8 + s.phase
      if (s.state === 'work') { s.torso.rotation.x = 0.12; s.armL.rotation.x = -1.1 + Math.sin(k) * 0.18; s.armR.rotation.x = -1.1 + Math.sin(k + 1.7) * 0.18; s.head.rotation.set(Math.sin(t * 1.3 + s.phase) * 0.04, 0, 0); s.mug.visible = false }
      else if (s.state === 'idle') { s.torso.rotation.x = -0.18; s.armL.rotation.x = -0.15; const sip = Math.sin(t * 0.7 + s.phase) > 0.85; s.armR.rotation.x = sip ? -1.9 : -0.3; s.mug.visible = true; s.head.rotation.set(sip ? -0.25 : 0, Math.sin(t * 0.4 + s.phase) * 0.5, 0) }
      else { s.torso.rotation.x = -0.05; s.armL.rotation.x = -0.2; s.armR.rotation.x = -2.6 + Math.sin(t * 6) * 0.25; s.mug.visible = false; s.head.rotation.set(0, Math.sin(t * 1.5) * 0.2, 0) }
      s.bang.visible = s.state === 'question' && !s.inMeeting; s.paper.visible = s.state === 'report' && !s.inMeeting
      const bob = 2.35 + Math.sin(t * 3 + s.phase) * 0.08; s.bang.position.y = bob; s.paper.position.y = bob
      if (this.frame % 3 === 0) this.drawScreen(s, t)
      if (s.anim) { const a = s.anim; a.p = Math.min(1, a.p + 0.025); const e = a.p < 0.5 ? 2 * a.p * a.p : 1 - Math.pow(-2 * a.p + 2, 2) / 2; s.body.position.lerpVectors(a.from, a.to, e); if (a.p >= 1) s.anim = null }
    }
    for (const r of this.rooms.values()) {
      r.light.intensity += ((this.meeting?.office === r.o.slug ? 6 : 0) - r.light.intensity) * 0.05
      if (this.frame % 30 === 0) this.drawKpi(r, t)
    }
    if (this.camAnim) {
      const a = this.camAnim; a.p = Math.min(1, a.p + 0.03); const e = 1 - Math.pow(1 - a.p, 3)
      this.controls.target.lerpVectors(a.t0, a.t1, e); this.camera.position.copy(this.controls.target).add(a.off)
      this.camera.zoom = a.z0 + (a.z1 - a.z0) * e; this.camera.updateProjectionMatrix(); if (a.p >= 1) this.camAnim = null
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera); this.updateTags()
    this.raf = requestAnimationFrame(this.animate)
  }
}
