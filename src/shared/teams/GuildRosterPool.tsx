import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { PlayerRecord as Player } from '../../guildApi'
import { membersArt } from '../art'
import type { Role } from '../game/classes'
import { ArtIcon } from '../ui/ArtIcon'
import { classAccent } from '../game/classes'
import { ClassAvatar } from '../ui/ClassAvatar'
import { RolePill } from '../ui/RolePill'

export function GuildRosterPool({ players, hiddenAlts, totalPlayers, canEdit, dropActive, onDragStart, onDragOver, onDragLeave, onDrop, title = 'Available roster', description, hint, memberNote, memberStatus, dragHint }: {
  players: Player[]
  hiddenAlts: number
  totalPlayers: number
  canEdit: boolean
  title?: string
  description?: string
  hint?: string
  memberNote?: (player: Player) => ReactNode
  memberStatus?: (player: Player) => ReactNode
  dragHint?: string
  dropActive: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, playerId: string) => void
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: ReactDragEvent<HTMLElement>) => void
}) {
  const roles: Role[] = ['Tank', 'Healer', 'Melee', 'Ranged']

  return <aside className={`guild-roster-pool${dropActive ? ' drop-active' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <header className="guild-roster-pool-header"><div><h3>{title}</h3><p>{description ?? <>{players.length} ready and unassigned{hiddenAlts ? ` (${hiddenAlts} ${hiddenAlts === 1 ? 'alt' : 'alts'} hidden)` : ''} · {totalPlayers} total roster characters</>}</p></div><ArtIcon src={membersArt} className="roster-pool-art-icon" /></header>
    {roles.map((role) => {
      const group = players.filter((player) => player.role === role).sort((a, b) => a.name.localeCompare(b.name))
      return <details className={`roster-role-group role-group-${role.toLowerCase()}`} key={role} open={group.length > 0}>
        <summary><RolePill role={role} /><span className="roster-role-count">{group.length}</span><ChevronDown size={14} /></summary>
        <div className="roster-role-members">{group.map((player) => {
          return <div className={`roster-pool-member ${classAccent(player.className)}`} key={player.id} draggable={canEdit} onDragStart={(event) => onDragStart(event, player.id)} title={canEdit ? `Drag ${player.name} ${dragHint ?? 'to a standing team'}` : player.name}>
            <ClassAvatar player={player} /><span className="roster-pool-member-info"><strong>{player.name}</strong><small>{player.specialization || player.className}</small>{memberNote?.(player)}</span><span className="pool-unassigned">{memberStatus ? memberStatus(player) : 'Available'}</span>
          </div>
        })}{!group.length && <p className="roster-role-empty">No {role.toLowerCase()} characters</p>}</div>
      </details>
    })}
    {canEdit && <p className="roster-pool-drop-hint">{hint ?? 'Drop here to remove a standing assignment. Only raid-ready mains and alts appear in the available roster.'}</p>}
  </aside>
}
