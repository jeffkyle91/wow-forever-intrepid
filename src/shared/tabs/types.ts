import type { ComponentType, ReactNode } from 'react'
import type { useGuildData } from '../../useGuildData'
import type { RaidView } from '../game/teams'

// Contracts between the shell (src/shell) and the feature modules (src/features/*).
// A feature exports a TabDefinition from its tab.tsx; src/shell/tabs.ts lists them and the shell
// hands every tab one TabContext.
//
// TabContext carries no role string on purpose. Role display and the VIEW AS preview live in the
// shell (App.tsx, Topbar, Sidebar); a feature only gets the identity booleans below to show or hide
// controls. Firestore rules are the authorization boundary.
//
// This file is platform-owned: add new TabDefinition fields as optional so existing tabs keep
// compiling. A new TabContext is built on every render, so do not put ctx or ctx.openModal in a
// hook dependency array.

export type GuildData = ReturnType<typeof useGuildData>

export type TabContext = {
  data: GuildData
  query: string
  identity: {
    uid: string
    displayName: string
    // Guild Leader only (see canManageRoster in security.ts).
    canEditRoster: boolean
    // Guild Leader and Raid Leader (see canManageRaidData in security.ts).
    canEditRaidData: boolean
  }
  shell: {
    raidView: RaidView
    setRaidView: (view: RaidView) => void
  }
  feedback: {
    busy: boolean
    setBusy: (busy: boolean) => void
    setMutationError: (message: string) => void
    setNotice: (message: string) => void
  }
  openModal: (render: ModalRenderer) => void
  // Ids are matched as strings: an unknown id is ignored (and logged in development).
  // Does not clear the search query.
  navigate: (id: string) => void
}

// Rendered by the shell's ModalHost after <main>. Capture whatever is being edited (an award's
// priority, a player) in the closure when the modal is opened; read everything that changes
// (busy, identity, data) from the `live` argument, never from the ctx the modal was opened with.
// A renderer is a single JSX return of a feature modal component and has no hooks.
export type ModalRenderer = (args: { close: () => void; live: TabContext }) => ReactNode

export type TabDefinition = {
  // Also the string passed to navigate(). Declare tabs with `as const satisfies TabDefinition`
  // so ids stay literals.
  id: string
  // Sidebar label, page title and breadcrumb.
  label: string
  // Sidebar icon.
  art: string
  hint: string
  panelTitle: string
  // Hidden from the sidebar, and replaced by the fallback tab if selected, unless the role is Guild Leader.
  guildLeaderOnly?: boolean
  // Shows the search box with this placeholder.
  search?: { placeholder: string }
  // Count badge in the sidebar.
  navCount?: (ctx: TabContext) => number
  // Text beside the panel title.
  recordCount: (ctx: TabContext) => string
  // Left side of the panel footer.
  footer: (ctx: TabContext) => ReactNode
  // Buttons beside the page title.
  HeadingActions?: ComponentType<{ ctx: TabContext }>
  // Controls beside the search box.
  Toolbar?: ComponentType<{ ctx: TabContext }>
  Content: ComponentType<{ ctx: TabContext }>
}
