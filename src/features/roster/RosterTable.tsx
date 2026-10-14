import type { CSSProperties } from 'react'
import { Pencil } from 'lucide-react'
import type { PlayerRecord as Player, TenManTeam } from '../../guildApi'
import { classColorKey } from '../../shared/game/classes'
import { tenManTeams } from '../../shared/game/teams'
import { ClassAvatar } from '../../shared/ui/ClassAvatar'
import { EmptyRow } from '../../shared/ui/EmptyRow'
import { RolePill } from '../../shared/ui/RolePill'

export function RosterTable({ players, assignments, canEdit, onEdit }: { players: Player[]; assignments: Record<string, TenManTeam>; canEdit: boolean; onEdit: (player: Player) => void }) {
  return <div className="table-scroll"><table className="data-table roster-table"><thead><tr><th>CHARACTER</th><th>CLASS</th><th>SPECIALIZATION</th><th>ROLE</th><th className="team-column-heading">10-PLAYER TEAM</th><th>APP ACCESS</th>{canEdit && <th><span className="visually-hidden">Actions</span></th>}</tr></thead><tbody>
    {players.map((player, index) => {
      const assignedTeam = tenManTeams.find((team) => team.key === assignments[player.id])
      return <tr key={player.id} className="stagger-row" style={{ '--row-index': index } as CSSProperties}>
        <td><span className="character-cell"><ClassAvatar player={player} /><strong>{player.name}</strong></span></td>
        <td><span className={`class-name class-color-${classColorKey(player.className)}`}>{player.className}</span></td>
        <td><span className={`specialization-name class-color-${classColorKey(player.className)}`}>{player.specialization || 'Not set'}</span></td>
        <td><RolePill role={player.role} /></td>
        <td className="team-dot-cell">{assignedTeam ? <span className={`team-dot-indicator team-dot-${assignedTeam.key}`} role="img" aria-label={`${assignedTeam.name} team`} title={`${assignedTeam.name} team`} /> : <span className="unassigned-label">Unassigned</span>}</td>
        <td><span className={player.linkedUid ? 'linked-account-status linked' : 'linked-account-status'}>{player.linkedUid ? 'Linked' : 'No account'}</span></td>
        {canEdit && <td><button className="row-action" onClick={() => onEdit(player)} title={`Edit ${player.name}`} aria-label={`Edit ${player.name}`}><Pencil size={15} /></button></td>}
      </tr>
    })}
    {!players.length && <EmptyRow colSpan={canEdit ? 7 : 6} title="No members found" detail="Try a different search or add a guild member." />}
  </tbody></table></div>
}
