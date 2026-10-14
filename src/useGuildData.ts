import { useEffect, useState } from 'react'
import {
  subscribeGuildCollection,
  type AfkEntryRecord,
  type AwardRecord,
  type JoinRequestRecord,
  type MembershipRecord,
  type PlayerRecord,
  type PriorityRecord,
  type RaidRecord,
  type TeamAssignmentRecord,
} from './guildApi'
import type { GuildRole } from './security'
import { normalizeAward, normalizeJoinRequest, normalizeMember, normalizePlayer, normalizePriority } from './shared/lib/normalize'

export function useGuildData(enabled: boolean, actualRole: GuildRole | null) {
  const [roster, setRoster] = useState<PlayerRecord[]>([])
  const [assignments, setAssignments] = useState<Record<string, TeamAssignmentRecord['team']>>({})
  const [priorities, setPriorities] = useState<PriorityRecord[]>([])
  const [awards, setAwards] = useState<AwardRecord[]>([])
  const [afkEntries, setAfkEntries] = useState<AfkEntryRecord[]>([])
  const [raids, setRaids] = useState<RaidRecord[]>([])
  const [members, setMembers] = useState<MembershipRecord[]>([])
  const [joinRequests, setJoinRequests] = useState<JoinRequestRecord[]>([])
  const [dataError, setDataError] = useState('')
  // How many documents each normalized collection skipped in its latest snapshot.
  const [unreadableByCollection, setUnreadableByCollection] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!enabled) return
    const onError = (error: Error) => setDataError(error.message)
    const countUnreadable = (name: string, dropped: number) => setUnreadableByCollection((current) => current[name] === dropped ? current : { ...current, [name]: dropped })
    const unsubscribers = [
      subscribeGuildCollection<PlayerRecord>('roster', (records, dropped) => { setRoster(records); countUnreadable('roster', dropped) }, onError, normalizePlayer),
      subscribeGuildCollection<TeamAssignmentRecord>('teamAssignments', (records) => setAssignments(Object.fromEntries(records.map(({ id, team }) => [id, team]))), onError),
      subscribeGuildCollection<PriorityRecord>('lootPriorities', (records, dropped) => { setPriorities(records); countUnreadable('lootPriorities', dropped) }, onError, normalizePriority),
      subscribeGuildCollection<AwardRecord>('awards', (records, dropped) => { setAwards(records.sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))); countUnreadable('awards', dropped) }, onError, normalizeAward),
      subscribeGuildCollection<AfkEntryRecord>('afkEntries', (records) => setAfkEntries(records.sort((a, b) => a.startDate.localeCompare(b.startDate))), onError),
      subscribeGuildCollection<RaidRecord>('raids', (records) => setRaids(records.sort((a, b) => a.date.localeCompare(b.date))), onError),
    ]
    if (actualRole === 'Guild Leader') {
      unsubscribers.push(subscribeGuildCollection<MembershipRecord>('members', (records, dropped) => { setMembers(records); countUnreadable('members', dropped) }, onError, normalizeMember))
      unsubscribers.push(subscribeGuildCollection<JoinRequestRecord>('joinRequests', (requests, dropped) => { setJoinRequests(requests.filter((request) => request.status === 'pending')); countUnreadable('joinRequests', dropped) }, onError, normalizeJoinRequest))
    }
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      setUnreadableByCollection({})
    }
  }, [enabled, actualRole])

  return {
    roster,
    assignments,
    priorities,
    awards,
    afkEntries,
    raids,
    members: actualRole === 'Guild Leader' ? members : [],
    joinRequests: actualRole === 'Guild Leader' ? joinRequests : [],
    dataError,
    // Documents in roster, lootPriorities, awards (and members and joinRequests for a Guild Leader) that
    // could not be read and were skipped. Show it to leaders only.
    unreadable: Object.values(unreadableByCollection).reduce((total, count) => total + count, 0),
  }
}
