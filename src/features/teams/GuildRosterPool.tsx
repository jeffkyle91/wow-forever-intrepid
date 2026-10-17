import type { DragEvent as ReactDragEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import type { PlayerRecord as Player } from '../../guildApi'
import { membersArt } from '../../shared/art'
import type { Role } from '../../shared/game/classes'
import { ArtIcon } from '../../shared/ui/ArtIcon'
import { classAccent } from '../../shared/game/classes'
import { ClassAvatar } from '../../shared/ui/ClassAvatar'
import { RolePill } from '../../shared/ui/RolePill'

export function GuildRosterPool({ players, hiddenAlts, totalPlayers, canEdit, dropActive, onDragStart, onDragOver, onDragLeave, onDrop }: {
  players: Player[]
  hiddenAlts: number
  totalPlayers: number
  canEdit: boolean
  dropActive: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, playerId: string) => void
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: ReactDragEvent<HTMLElement>) => void
}) {
  const roles: Role[] = ['Tank', 'Healer', 'Melee', 'Ranged']

  return <aside className={`guild-roster-pool${dropActive ? ' drop-active' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <header className="guild-roster-pool-header"><div><h3>Available roster</h3><p>{players.length} available{hiddenAlts ? ` (${hiddenAlts} ${hiddenAlts === 1 ? 'alt' : 'alts'} hidden)` : ''} · {totalPlayers} total guild members</p></div><ArtIcon src={membersArt} className="roster-pool-art-icon" /></header>
    {roles.map((role) => {
      const group = players.filter((player) => player.role === role).sort((a, b) => a.name.localeCompare(b.name))
      return <details className={`roster-role-group role-group-${role.toLowerCase()}`} key={role} open>
        <summary><RolePill role={role} /><span className="roster-role-count">{group.length}</span><ChevronDown size={14} /></summary>
        <div className="roster-role-members">{group.map((player) => {
          return <div className={`roster-pool-member ${classAccent(player.className)}`} key={player.id} draggable={canEdit} onDragStart={(event) => onDragStart(event, player.id)} title={canEdit ? `Drag ${player.name} to a 10-player team` : player.name}>
            <ClassAvatar player={player} /><span className="roster-pool-member-info"><strong>{player.name}</strong><small>{player.specialization || player.className}</small></span><span className="pool-unassigned">Available</span>
          </div>
        })}{!group.length && <p className="roster-role-empty">No {role.toLowerCase()} characters</p>}</div>
      </details>
    })}
    {canEdit && <p className="roster-pool-drop-hint">Drop an assigned character here to return them to the available roster.</p>}
  </aside>
}
