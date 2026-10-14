import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { GuildRole } from '../security'
import { guildArt, guildCrest, seasonArt } from '../shared/art'
import type { TabContext } from '../shared/tabs/types'
import { ArtIcon } from '../shared/ui/ArtIcon'
import { isTabVisible, type TabId, type tabList } from './tabs'

export function Sidebar({ tabs, activeId, effectiveRole, ctx, onSelect }: { tabs: typeof tabList; activeId: TabId; effectiveRole: GuildRole | null; ctx: TabContext; onSelect: (id: TabId) => void }) {
  return (
    <aside className="sidebar">
      <a className="brand" href="#top" aria-label="Intrepid raid desk home"><span className="brand-mark"><img src={guildCrest} alt="" /></span><span className="brand-copy"><strong>INTREPID</strong><small>RAID DESK</small></span></a>
      <div className="guild-switcher"><span className="guild-emblem"><ArtIcon src={guildArt} className="guild-emblem-art" /></span><span className="guild-name"><strong>Intrepid</strong><small>Guild workspace</small></span><ChevronDown size={15} /></div>
      <div className="side-label">GUILD TOOLS</div>
      <nav className="main-nav" aria-label="Guild tools">
        {tabs.map((entry) => isTabVisible(entry, effectiveRole) && <NavButton key={entry.id} active={activeId === entry.id} onClick={() => onSelect(entry.id)} icon={<ArtIcon src={entry.art} className="nav-art-icon" />} label={entry.label} count={entry.navCount?.(ctx)} />)}
      </nav>
      <div className="sidebar-bottom"><div className="season-card"><span className="season-icon"><ArtIcon src={seasonArt} className="season-art-icon" /></span><span><small>SEASON</small><strong>Launch prep</strong></span><span className="season-dot" /></div><span className="version-label">SECURE WORKSPACE · 0.2.0</span></div>
    </aside>
  )
}

function NavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count?: number }) {
  return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <span className="nav-count">{count}</span>}</button>
}
