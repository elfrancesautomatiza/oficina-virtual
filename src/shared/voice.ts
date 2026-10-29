// Messages dictés à voix haute : préfixe « [Vocal] … » remplacé par un discret 🎙 à l'affichage.
export const stripVoicePrefix = (t: string): string => {
  if (!t.startsWith('[Vocal] ')) return t
  const nl = t.indexOf('\n')
  return `🎙 ${nl >= 0 ? t.slice(nl + 1).trim() : ''}`.trim()
}
