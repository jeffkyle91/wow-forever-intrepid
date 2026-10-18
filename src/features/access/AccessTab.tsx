import { approveJoinRequest, rejectJoinRequest, updateMembershipAccess, type JoinRequestRecord } from '../../guildApi'
import type { GuildRole } from '../../security'
import type { TabContext } from '../../shared/tabs/types'
import { GuildAccessManager } from './GuildAccessManager'
import { MemberAccessModal } from './MemberAccessModal'

export function AccessTab({ ctx }: { ctx: TabContext }) {
  const { roster, members, joinRequests } = ctx.data
  const { busy, setBusy, setMutationError } = ctx.feedback

  async function changeMemberAccess(uid: string, role: GuildRole, playerId: string | null) {
    if (members.find((member) => member.id === uid)?.role === 'Guild Leader' && role !== 'Guild Leader'
      && members.filter((member) => member.role === 'Guild Leader').length < 2) {
      setMutationError('Promote another Guild Leader before changing the last Guild Leader role.')
      return
    }
    setBusy(true)
    try {
      await updateMembershipAccess(uid, role, playerId)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not update member role.')
    } finally {
      setBusy(false)
    }
  }

  async function approveRequest(request: JoinRequestRecord, role: GuildRole, playerId: string | null) {
    setBusy(true)
    try {
      await approveJoinRequest(request, role, playerId)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not approve join request.')
    } finally {
      setBusy(false)
    }
  }

  async function rejectRequest(uid: string) {
    setBusy(true)
    try {
      await rejectJoinRequest(uid)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not reject join request.')
    } finally {
      setBusy(false)
    }
  }

  return <GuildAccessManager members={members} roster={roster} requests={joinRequests} busy={busy} currentUid={ctx.identity.uid}  onMemberChange={changeMemberAccess} onToggleRemoved={(uid, restore) => ctx.openModal(({ close, live }) => <MemberAccessModal uid={uid} restore={restore} close={close} live={live} />)} onApprove={approveRequest} onReject={rejectRequest} />
}
