import type { ReactNode } from 'react'
import type { CouncilStatus } from '../guildApi'
import { lootArt, membersArt, trophyArt } from '../shared/art'
import { ArtIcon } from '../shared/ui/ArtIcon'

export function StatStrip({ roster, priorities, awards, councilStatus }: { roster: number; priorities: number; awards: number; councilStatus: CouncilStatus }) {
  return (
    <section className="stat-strip" aria-label="Guild overview">
      <Stat icon={<ArtIcon src={membersArt} className="stat-art-icon" />} tone="green" label="ROSTER" value={roster} detail="members" />
      <Stat icon={<ArtIcon src={lootArt} className="stat-art-icon" />} tone="orange" label="PRIORITY LIST" value={priorities} detail="items tracked" />
      <Stat icon={<ArtIcon src={trophyArt} className="stat-art-icon" />} tone="dark" label="AWARDED" value={awards} detail="decisions logged" />
      <div className={`stat-callout council-${councilStatus}`}><span className="pulse-dot" /> COUNCIL STATUS <strong>{councilStatus === 'live' ? 'Live' : 'Deliberating'}</strong></div>
    </section>
  )
}

function Stat({ icon, tone, label, value, detail }: { icon: ReactNode; tone: string; label: string; value: number; detail: string }) {
  return <div className="stat-cell"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}<small> {detail}</small></strong></div>
}
