// Génère des portraits originaux et déterministes (SVG) à partir d'une graine.
import type { AvatarSpec } from './types'

// Teintes de peau variées : claires, mates, asiatiques, brunes, noires (équilibrées, pas de dominante).
const SKINS = ['#f6d5b8', '#f1c9a5', '#eac096', '#f0c8a0', '#d9a77a', '#c98e63', '#e8b792', '#a56b43', '#7a4a2b', '#5b3a24']
const HAIRS = ['#2b1d14', '#5a3a22', '#a86b2c', '#d9a441', '#1a1a1a', '#8c8c8c', '#b23a2a', '#e8d9c0']
const SHIRTS = ['#1f6feb', '#e0534f', '#2a9d8f', '#6a4c93', '#f4a261', '#264653', '#ff7b9c', '#3a86ff', '#118ab2', '#06d6a0']
const STYLES_F: AvatarSpec['hairStyle'][] = ['long', 'bun', 'bob', 'curly', 'short']
const STYLES_M: AvatarSpec['hairStyle'][] = ['short', 'curly', 'bald', 'mohawk', 'short']

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0
    return s / 0xffffffff
  }
}

export function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function makeAvatar(seedInput: string | number, gender: 'f' | 'm'): AvatarSpec {
  const seed = typeof seedInput === 'number' ? seedInput : hashString(seedInput)
  const r = rng(seed)
  const pick = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length)]
  const skin = pick(SKINS)
  const hairAny = pick(HAIRS)
  // Cheveux cohérents avec la teinte : peaux foncées et « asiatiques » → cheveux bruns/noirs.
  const asian = skin === '#f0c8a0'
  const darkSkin = ['#a56b43', '#7a4a2b', '#5b3a24'].includes(skin)
  const hair = asian || darkSkin ? (['#1a1a1a', '#2b1d14'].includes(hairAny) ? hairAny : '#1a1a1a') : hairAny
  return {
    seed,
    gender,
    skin,
    hair,
    eyes: asian ? 'almond' : 'round',
    hairStyle: pick(gender === 'f' ? STYLES_F : STYLES_M),
    shirt: pick(SHIRTS),
    glasses: r() < 0.4,
    beard: gender === 'm' && r() < 0.45,
    earrings: gender === 'f' && r() < 0.5
  }
}

/** SVG 120x120, buste de face, style illustration plate (ombres douces, yeux, lèvres, col). */
export function avatarSvg(a: AvatarSpec, size = 120): string {
  const id = `${a.seed}`
  const dark = shade(a.skin, -28)
  const deep = shade(a.skin, -50)
  const hairDark = shade(a.hair, -30)
  const lum = luminance(a.skin)
  const lip = lum > 0.55 ? '#c4706a' : shade(a.skin, -55)
  const blush = lum > 0.45 ? 0.22 : 0.12
  const iris = a.iris ?? '#3b2a20'
  const almond = a.eyes === 'almond'
  const hairBack = (() => {
    switch (a.hairStyle) {
      case 'long': return `<path d="M29 58 Q28 20 60 20 Q92 20 91 58 L94 100 Q76 106 60 104 Q44 106 26 100 Z" fill="${a.hair}"/>`
      case 'bob': return `<path d="M29 58 Q29 21 60 21 Q91 21 91 58 L92 80 Q86 86 78 84 L42 84 Q34 86 28 80 Z" fill="${a.hair}"/>`
      case 'curly': return `<g fill="${a.hair}"><circle cx="60" cy="40" r="26"/><circle cx="38" cy="46" r="15"/><circle cx="82" cy="46" r="15"/><circle cx="33" cy="64" r="12"/><circle cx="87" cy="64" r="12"/><circle cx="36" cy="80" r="9"/><circle cx="84" cy="80" r="9"/></g>`
      case 'bun': return `<circle cx="60" cy="19" r="12" fill="${a.hair}"/><circle cx="60" cy="19" r="12" fill="${hairDark}" opacity="0.25"/>`
      default: return ''
    }
  })()
  const hairFront = (() => {
    switch (a.hairStyle) {
      case 'short': return `<path d="M34 54 Q32 26 60 25 Q88 26 86 54 Q84 42 76 38 Q64 44 48 39 Q38 42 34 54 Z" fill="${a.hair}"/>`
      case 'bun': return `<path d="M34 54 Q33 28 60 27 Q87 28 86 54 Q78 38 60 37 Q42 38 34 54 Z" fill="${a.hair}"/>`
      case 'mohawk': return `<path d="M53 40 Q56 12 60 8 Q64 12 67 40 Z" fill="${a.hair}"/><path d="M38 50 Q40 40 60 38 Q80 40 82 50 Q60 44 38 50 Z" fill="${a.hair}" opacity="0.55"/>`
      case 'long': return `<path d="M34 58 Q32 27 60 26 Q88 27 86 58 Q82 40 66 35 Q58 44 44 42 Q37 48 34 58 Z" fill="${a.hair}"/>`
      case 'bob': return `<path d="M34 58 Q33 27 60 26 Q87 27 86 58 Q84 42 60 38 Q40 40 34 58 Z" fill="${a.hair}"/>`
      case 'curly': return `<g fill="${a.hair}"><circle cx="46" cy="36" r="9"/><circle cx="60" cy="33" r="10"/><circle cx="74" cy="36" r="9"/><circle cx="38" cy="45" r="6"/><circle cx="82" cy="45" r="6"/></g>`
      case 'bald': return `<path d="M42 36 Q52 31 60 31" stroke="#fff" stroke-opacity="0.25" stroke-width="3" fill="none" stroke-linecap="round"/>`
    }
  })()
  const beard = a.beard
    ? `<path d="M37 62 Q38 92 60 95 Q82 92 83 62 Q80 76 72 80 Q66 76 60 77 Q54 76 48 80 Q40 76 37 62 Z" fill="${a.hair}" opacity="0.92"/><path d="M52 80 Q60 76 68 80" stroke="${lip}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    : ''
  const glasses = a.glasses
    ? `<g fill="none" stroke="#1d1d24" stroke-width="2"><rect x="40" y="53" width="16" height="12" rx="4"/><rect x="64" y="53" width="16" height="12" rx="4"/><path d="M56 58 Q60 55 64 58"/><path d="M40 57 L35 55"/><path d="M80 57 L85 55"/></g><path d="M43 56 L47 54" stroke="#fff" stroke-opacity="0.5" stroke-width="1.4"/><path d="M67 56 L71 54" stroke="#fff" stroke-opacity="0.5" stroke-width="1.4"/>`
    : ''
  const earrings = a.earrings ? `<circle cx="34" cy="71" r="2.6" fill="#f7c948"/><circle cx="86" cy="71" r="2.6" fill="#f7c948"/>` : ''
  const eye = (cx: number): string => almond
    ? `<path d="M${cx - 5} 59.5 Q${cx} 55.5 ${cx + 5} 58.5 Q${cx} 62 ${cx - 5} 59.5 Z" fill="#fff"/><circle cx="${cx}" cy="59.2" r="2.1" fill="${iris}"/><circle cx="${cx}" cy="59.2" r="1" fill="#111"/><path d="M${cx - 5.5} 59.5 Q${cx} 55 ${cx + 5.5} 58.2" stroke="#1a1a1a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="${cx}" cy="59.5" rx="4.6" ry="3.4" fill="#fff"/><circle cx="${cx}" cy="59.7" r="2.5" fill="${iris}"/><circle cx="${cx}" cy="59.7" r="1.2" fill="#111"/><circle cx="${cx + 0.9}" cy="58.6" r="0.7" fill="#fff"/><path d="M${cx - 5} 58 Q${cx} 54.5 ${cx + 5} 58" stroke="#1a1a1a" stroke-width="1.3" fill="none" stroke-linecap="round"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}">
  <defs>
    <clipPath id="c${id}"><circle cx="60" cy="60" r="58"/></clipPath>
    <radialGradient id="bg${id}" cx="50%" cy="35%" r="70%"><stop offset="0%" stop-color="${shade(a.shirt, 85)}"/><stop offset="100%" stop-color="${shade(a.shirt, 45)}"/></radialGradient>
  </defs>
  <circle cx="60" cy="60" r="58" fill="url(#bg${id})"/>
  <g clip-path="url(#c${id})">
    ${hairBack}
    <path d="M14 130 Q16 98 46 92 L74 92 Q104 98 106 130 Z" fill="${a.shirt}"/>
    <path d="M22 130 Q26 104 44 96" stroke="${shade(a.shirt, -25)}" stroke-width="2" fill="none" opacity="0.6"/>
    <path d="M98 130 Q94 104 76 96" stroke="${shade(a.shirt, -25)}" stroke-width="2" fill="none" opacity="0.6"/>
    <path d="M51 78 L69 78 L70 94 Q60 100 50 94 Z" fill="${dark}"/>
    <path d="M48 92 L60 104 L72 92 L68 90 L60 98 L52 90 Z" fill="${shade(a.shirt, 35)}"/>
    <ellipse cx="35" cy="62" rx="4.5" ry="6.5" fill="${dark}"/>
    <ellipse cx="85" cy="62" rx="4.5" ry="6.5" fill="${dark}"/>
    <path d="M36 56 Q36 30 60 30 Q84 30 84 56 Q84 74 76 83 Q68 91 60 91 Q52 91 44 83 Q36 74 36 56 Z" fill="${a.skin}"/>
    <path d="M44 83 Q52 91 60 91 Q68 91 76 83 Q68 87 60 87 Q52 87 44 83 Z" fill="${dark}" opacity="0.35"/>
    <circle cx="45" cy="70" r="5.5" fill="#ff7a6b" opacity="${blush}"/><circle cx="75" cy="70" r="5.5" fill="#ff7a6b" opacity="${blush}"/>
    ${hairFront}
    ${eye(49)}${eye(71)}
    <path d="M43 51 Q49 47.5 55 50.5" stroke="${hairDark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M65 50.5 Q71 47.5 77 51" stroke="${hairDark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M60 61 Q58.5 68 56.5 70.5 Q60 72.5 63.5 70.5" stroke="${deep}" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.7"/>
    <path d="M52 77.5 Q60 83.5 68 77.5 Q60 80 52 77.5 Z" fill="${lip}" stroke="${lip}" stroke-width="1.6" stroke-linejoin="round"/>
    ${beard}${glasses}${earrings}
  </g>
</svg>`
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const c = (v: number) => Math.max(0, Math.min(255, v + amt))
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255)
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}
