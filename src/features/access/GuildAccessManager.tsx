import { useState } from 'react'
import { Check } from 'lucide-react'
import type { JoinRequestRecord, PlayerRecord as Player } from '../../guildApi'
import { guildRoles, type GuildRole } from '../../security'
import { EmptyRow } from '../../shared/ui/EmptyRow'

export function GuildAccessManager({ members, roster, requests, busy, canImport, onMemberChange, onApprove, onReject, onImport }: {
  members: { id: string; email: string; displayName: string; role: GuildRole; playerId?: string | null }[]
  roster: Player[]
  requests: JoinRequestRecord[]
  busy: boolean
  canImport: boolean
  onMemberChange: (uid: string, role: GuildRole, playerId: string | null) => void
  onApprove: (request: JoinRequestRecord, role: GuildRole, playerId: string | null) => void
  onReject: (uid: string) => void
  onImport: () => void
}) {
  const [requestRoles, setRequestRoles] = useState<Record<string, GuildRole>>({})
  const [requestPlayers, setRequestPlayers] = useState<Record<string, string>>({})

  return <div className="access-management">
    {canImport && <section className="import-notice"><div><strong>Existing browser data found?</strong><p>Import this browser’s roster, raid assignments, loot priorities, and award history into the shared guild space.</p></div><button className="button button-secondary" disabled={busy} onClick={onImport}>Import local data</button></section>}
    <section className="access-section"><header className="access-section-heading"><div><h3>Join requests</h3><p>Approve a request to create the member’s guild account and assign a role.</p></div><span className="access-count">{requests.length} pending</span></header>
      {requests.length ? <div className="request-list">{requests.map((request) => <article className="request-row" key={request.id}><span className="request-avatar">{request.displayName.slice(0, 1).toUpperCase()}</span><div className="request-person"><strong>{request.displayName}</strong><small>{request.email}</small></div><label className="request-role">Assign role<select value={requestRoles[request.id] ?? 'Member'} onChange={(event) => setRequestRoles((current) => ({ ...current, [request.id]: event.target.value as GuildRole }))} disabled={busy}>{guildRoles.map((role) => <option key={role}>{role}</option>)}</select></label><label className="request-character">Link character<select value={requestPlayers[request.id] ?? ''} onChange={(event) => setRequestPlayers((current) => ({ ...current, [request.id]: event.target.value }))} disabled={busy}><option value="">Link later</option>{roster.filter((player) => !player.linkedUid).map((player) => <option key={player.id} value={player.id}>{player.name} · {player.className}</option>)}</select></label><button className="button button-primary request-approve" disabled={busy} onClick={() => onApprove(request, requestRoles[request.id] ?? 'Member', requestPlayers[request.id] || null)}><Check size={14} /> Approve</button><button className="button button-secondary request-reject" disabled={busy} onClick={() => onReject(request.userId)}>Decline</button></article>)}</div> : <div className="access-empty">No pending access requests.</div>}
    </section>
    <section className="access-section"><header className="access-section-heading"><div><h3>Guild accounts</h3><p>Roles are enforced by Firestore. Only Guild Leaders can change access.</p></div><span className="access-count">{members.length} active</span></header>
      <div className="table-scroll"><table className="data-table member-access-table"><thead><tr><th>MEMBER</th><th>EMAIL</th><th>CHARACTER</th><th>ROLE</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><strong>{member.displayName || 'Unnamed member'}</strong></td><td>{member.email}</td><td><select className="member-role-select" value={member.playerId ?? ''} disabled={busy} aria-label={`Roster character for ${member.displayName || member.email}`} onChange={(event) => onMemberChange(member.id, member.role, event.target.value || null)}><option value="">No linked character</option>{roster.filter((player) => !player.linkedUid || player.linkedUid === member.id).map((player) => <option key={player.id} value={player.id}>{player.name} · {player.className}</option>)}</select></td><td><select className="member-role-select" value={member.role} disabled={busy} aria-label={`Role for ${member.displayName || member.email}`} onChange={(event) => onMemberChange(member.id, event.target.value as GuildRole, member.playerId ?? null)}>{guildRoles.map((role) => <option key={role}>{role}</option>)}</select></td></tr>)}{!members.length && <EmptyRow colSpan={4} title="No guild accounts" detail="Provision the first Guild Leader in Firebase, then manage the rest here." />}</tbody></table></div>
    </section>
  </div>
}
