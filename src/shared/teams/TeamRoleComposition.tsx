import type { ReactNode } from 'react'
import type { PlayerRecord as Player } from '../../guildApi'
import { raidRoles, type Role } from '../game/classes'
import { RoleIcon } from '../ui/RolePill'

function RoleCount({ role, count }: { role: Role; count: number }) {
  return <span className={`team-role-count role-${role.toLowerCase()}`} title={`${role}: ${count}`} aria-label={`${role}: ${count}`}><RoleIcon role={role} size={12} /><strong>{count}</strong></span>
}

export function TeamRoleComposition({ members, responseSummary }: { members: Player[]; responseSummary?: ReactNode }) {
  const roleCounts = raidRoles.map((role) => ({ role, count: members.filter((player) => player.role === role).length }))

  return <div className="team-role-composition" aria-label={`Composition: ${roleCounts.map(({ role, count }) => `${count} ${role}`).join(', ')}`}>
    {roleCounts.map(({ role, count }) => <RoleCount key={role} role={role} count={count} />)}
    {responseSummary}
  </div>
}
