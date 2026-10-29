import React from 'react'
import { ConvList } from './ConvList'
import { useConversations } from './useConversations'

/** Barre latérale gauche du Mac : toutes les conversations, tous bureaux, comme WhatsApp. */
export function MessengerSidebar(props: {
  open: boolean
  onToggle: () => void
  selected: string | null
  onOpen: (office: string, slug: string, hidden: boolean, seenAt: string) => void
}): React.JSX.Element {
  const { list, busy, toggleUnread, open } = useConversations()
  const total = list.filter((c) => c.unread > 0 || c.manualUnread).length
  if (!props.open) {
    return (
      <aside className="msg-side closed">
        <button className="msg-reopen" title="Abrir la mensajería" onClick={props.onToggle}>💬{total > 0 && <span className="badge">{total}</span>}</button>
      </aside>
    )
  }
  return (
    <aside className="msg-side">
      <ConvList
        conversations={list}
        busy={busy}
        selected={props.selected}
        onOpen={(c) => { props.onOpen(c.office, c.slug, c.officeHidden, c.unread > 0 || c.manualUnread ? c.seenAt : ''); open(c) }}
        onToggleUnread={toggleUnread}
        header={
          <div className="msg-head">
            <span className="msg-title">Mensajería</span>
            <span className="spacer" />
            <button title="Ocultar la mensajería" onClick={props.onToggle}>⟨</button>
          </div>
        }
      />
    </aside>
  )
}
