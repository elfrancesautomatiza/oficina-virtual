import React from 'react'
import type { AvatarSpec } from '@shared/types'
import { avatarSvg } from '@shared/avatar'

export function Avatar({ spec, size = 64 }: { spec: AvatarSpec; size?: number }): React.JSX.Element {
  return <span className="avatar" dangerouslySetInnerHTML={{ __html: avatarSvg(spec, size) }} />
}
