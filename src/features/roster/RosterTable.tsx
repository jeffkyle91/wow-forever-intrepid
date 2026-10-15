import { useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import type { PlayerRecord as Player, TenManTeam } from '../../guildApi'
import { classColorKey } from '../../shared/game/classes'
import type { TeamOption } from '../../shared/game/teams'
import { ClassAvatar } from '../../shared/ui/ClassAvatar'
import { EmptyRow } from '../../shared/ui/EmptyRow'
import { RolePill } from '../../shared/ui/RolePill'
import { groupAlts } from './filter'

export function RosterTable({ teams, players, allPlayers, assignments, canEdit, onEdit }: { teams: TeamOption[]; players: Player[]; allPlayers: Player[]; assignments: Record<string, TenManTeam>; canEdit: boolean; onEdit: (player: Player) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const { rows, mainNames } = groupAlts(players, allPlayers, collapsed)
  const toggle = (id: string) => setCollapsed((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next })
  return <div className="table-scroll"><table className="data-table roster-table"><thead><tr><th>CHARACTER</th><th>CLASS</th><th>SPECIALIZATION</th><th>ROLE</th><th className="team-column-heading">10-PLAYER TEAM</th><th>APP ACCESS</th>{canEdit && <th><span className="visually-hidden">Actions</span></th>}</tr></thead><tbody>
    {rows.map(({ player, isAlt, altCount }, index) => {
      const assignedTeam = teams.find((team) => team.key === assignments[player.id])
      return <tr key={player.id} className={isAlt ? 'stagger-row alt-row' : 'stagger-row'} style={{ '--row-index': index } as CSSProperties}>
        <td><span className="character-cell">{altCount ? <button type="button" className="alt-toggle" onClick={() => toggle(player.id)} aria-expanded={!collapsed.has(player.id)} aria-label={`${collapsed.has(player.id) ? 'Show' : 'Hide'} alts of ${player.name}`}>{collapsed.has(player.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button> : !isAlt && <span className="alt-toggle-spacer" />}<ClassAvatar player={player} /><span className="character-name-stack"><strong>{player.name}</strong>{altCount ? <small className="table-subtext">{altCount} {altCount === 1 ? 'alt' : 'alts'}</small> : !isAlt && mainNames.get(player.id) && <small className="table-subtext">Alt of {mainNames.get(player.id)}</small>}</span></span></td>
        <td><span className={`class-name class-color-${classColorKey(player.className)}`}>{player.className}</span></td>
        <td><span className={`specialization-name class-color-${classColorKey(player.className)}`}>{player.specialization || 'Not set'}</span></td>
        <td><RolePill role={player.role} /></td>
        <td className="team-dot-cell">{assignedTeam ? <span className={`team-dot-indicator team-dot-${assignedTeam.key}`} role="img" aria-label={`${assignedTeam.name} team`} title={`${assignedTeam.name} team`} /> : <span className="unassigned-label">Unassigned</span>}</td>
        <td><span className={player.linkedUid ? 'linked-account-status linked' : 'linked-account-status'}>{player.linkedUid ? 'Linked' : 'No account'}</span></td>
        {canEdit && <td><button className="row-action" onClick={() => onEdit(player)} title={`Edit ${player.name}`} aria-label={`Edit ${player.name}`}><Pencil size={15} /></button></td>}
      </tr>
    })}
    {!rows.length && <EmptyRow colSpan={canEdit ? 7 : 6} title="No members found" detail="Try a different search or add a guild member." />}
  </tbody></table></div>
}
