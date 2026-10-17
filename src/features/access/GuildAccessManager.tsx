import { useState } from 'react'
import { Check } from 'lucide-react'
import type { JoinRequestRecord, MembershipRecord, PlayerRecord as Player } from '../../guildApi'
import { guildRoles, type GuildRole } from '../../security'
import { classAccentRow } from '../../shared/game/classes'
import { EmptyRow } from '../../shared/ui/EmptyRow'

export function GuildAccessManager({ members, roster, requests, busy, currentUid, onMemberChange, onToggleRemoved, onApprove, onReject }: {
  members: MembershipRecord[]
  roster: Player[]
  requests: JoinRequestRecord[]
  busy: boolean
  currentUid: string
  onMemberChange: (uid: string, role: GuildRole, playerId: string | null) => void
  onToggleRemoved: (uid: string, restore: boolean) => void
  onApprove: (request: JoinRequestRecord, role: GuildRole, playerId: string | null) => void
  onReject: (uid: string) => void
}) {
  const [requestRoles, setRequestRoles] = useState<Record<string, GuildRole>>({})
  const [requestPlayers, setRequestPlayers] = useState<Record<string, string>>({})
  const activeCount = members.filter((member) => member.role !== 'Removed').length

  return <div className="access-management">
    <section className="access-section"><header className="access-section-heading"><div><h3>Join requests</h3><p>Approve a request to create the member’s guild account and assign a role.</p></div><span className="access-count">{requests.length} pending</span></header>
      {requests.length ? <div className="request-list">{requests.map((request) => <article className="request-row" key={request.id}><span className="request-avatar">{(request.displayName ?? '').slice(0, 1).toUpperCase()}</span><div className="request-person"><strong>{request.displayName}</strong><small>{request.email}</small></div><label className="request-role">Assign role<select value={requestRoles[request.id] ?? 'Member'} onChange={(event) => setRequestRoles((current) => ({ ...current, [request.id]: event.target.value as GuildRole }))} disabled={busy}>{guildRoles.map((role) => <option key={role}>{role}</option>)}</select></label><label className="request-character">Link character<select value={requestPlayers[request.id] ?? ''} onChange={(event) => setRequestPlayers((current) => ({ ...current, [request.id]: event.target.value }))} disabled={busy}><option value="">Link later</option>{roster.filter((player) => !player.linkedUid && !player.mainId).map((player) => <option key={player.id} value={player.id}>{player.name} · {player.className}</option>)}</select></label><button className="button button-primary request-approve" disabled={busy || members.some((member) => member.id === request.userId)} title={members.some((member) => member.id === request.userId) ? 'Already a member. Decline to dismiss this request.' : undefined} onClick={() => onApprove(request, requestRoles[request.id] ?? 'Member', requestPlayers[request.id] || null)}><Check size={14} /> Approve</button><button className="button button-secondary request-reject" disabled={busy} onClick={() => onReject(request.userId)}>Decline</button></article>)}</div> : <div className="access-empty">No pending access requests.</div>}
    </section>
    <section className="access-section"><header className="access-section-heading"><div><h3>Guild accounts</h3><p>Roles are enforced by Firestore. Only Guild Leaders can change access. Removing access preserves characters and history.</p></div><span className="access-count">{activeCount} active · {members.length - activeCount} removed</span></header>
      <div className="table-scroll"><table className="data-table member-access-table"><thead><tr><th>MEMBER</th><th>EMAIL</th><th>CHARACTER</th><th>ROLE / STATUS</th><th>ACCESS</th></tr></thead><tbody>{members.map((member) => <tr key={member.id} className={classAccentRow(roster.find((player) => player.id === member.playerId)?.className)}>
        <td><strong>{member.displayName || 'Unnamed member'}</strong></td><td>{member.email}</td>
        <td>{member.role === 'Removed' ? 'Not linked' : <select className="member-role-select" value={member.playerId ?? ''} disabled={busy} aria-label={`Roster character for ${member.displayName || member.email}`} onChange={(event) => { if (member.role !== 'Removed') onMemberChange(member.id, member.role, event.target.value || null) }}><option value="">No linked character</option>{roster.filter((player) => player.id === member.playerId || (!player.linkedUid && !player.mainId)).map((player) => <option key={player.id} value={player.id}>{player.name} · {player.className}</option>)}</select>}</td>
        <td>{member.role === 'Removed' ? 'Removed' : <select className="member-role-select" value={member.role} disabled={busy} aria-label={`Role for ${member.displayName || member.email}`} onChange={(event) => onMemberChange(member.id, event.target.value as GuildRole, member.playerId ?? null)}>{guildRoles.map((role) => <option key={role}>{role}</option>)}</select>}</td>
        <td><button className="button button-secondary" disabled={busy || member.id === currentUid} aria-label={`${member.role === 'Removed' ? 'Restore' : 'Remove'} access for ${member.displayName || member.email}`} onClick={() => onToggleRemoved(member.id, member.role === 'Removed')}>{member.role === 'Removed' ? 'Restore access' : 'Remove access'}</button></td>
      </tr>)}{!members.length && <EmptyRow colSpan={5} title="No guild accounts" detail="Provision the first Guild Leader in Firebase, then manage the rest here." />}</tbody></table></div>
    </section>
  </div>
}
