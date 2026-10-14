import { useEffect, useState } from 'react'
import { subscribeGuildCollection, type AwardRecord, type JoinRequestRecord, type MembershipRecord, type PlayerRecord, type PriorityRecord, type TeamAssignmentRecord } from './guildApi'
import type { GuildRole } from './security'

export function useGuildData(enabled: boolean, actualRole: GuildRole | null) {
  const [roster, setRoster] = useState<PlayerRecord[]>([])
  const [assignments, setAssignments] = useState<Record<string, TeamAssignmentRecord['team']>>({})
  const [priorities, setPriorities] = useState<PriorityRecord[]>([])
  const [awards, setAwards] = useState<AwardRecord[]>([])
  const [members, setMembers] = useState<MembershipRecord[]>([])
  const [joinRequests, setJoinRequests] = useState<JoinRequestRecord[]>([])
  const [dataError, setDataError] = useState('')

  useEffect(() => {
    if (!enabled) return
    const onError = (error: Error) => setDataError(error.message)
    const unsubscribers = [
      subscribeGuildCollection<PlayerRecord>('roster', setRoster, onError),
      subscribeGuildCollection<TeamAssignmentRecord>('teamAssignments', (records) => setAssignments(Object.fromEntries(records.map(({ id, team }) => [id, team]))), onError),
      subscribeGuildCollection<PriorityRecord>('lootPriorities', setPriorities, onError),
      subscribeGuildCollection<AwardRecord>('awards', (records) => setAwards(records.sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))), onError),
    ]
    if (actualRole === 'Guild Leader') {
      unsubscribers.push(subscribeGuildCollection<MembershipRecord>('members', setMembers, onError))
      unsubscribers.push(subscribeGuildCollection<JoinRequestRecord>('joinRequests', (requests) => setJoinRequests(requests.filter((request) => request.status === 'pending')), onError))
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [enabled, actualRole])

  return {
    roster,
    assignments,
    priorities,
    awards,
    members: actualRole === 'Guild Leader' ? members : [],
    joinRequests: actualRole === 'Guild Leader' ? joinRequests : [],
    dataError,
  }
}
