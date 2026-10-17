import { useEffect, useMemo, useState } from 'react'
import {
  subscribeGuildCollection,
  subscribeRaidZones,
  subscribeCharacterRequests,
  type AfkEntryRecord,
  type AwardRecord,
  type GuildSettings,
  type GuildSettingsRecord,
  type JoinRequestRecord,
  type MembershipRecord,
  type PlayerRecord,
  type PriorityRecord,
  type RaidRecord,
  type RaidZoneRecord,
  type TeamAssignmentRecord,
} from './guildApi'
import type { GuildRole } from './security'
import { useRosterComments } from './rosterComments'
import { currentPhaseNo, phaseNoOf } from './shared/game/phases'
import { defaultGuildSettings, resolveGuildSettings } from './shared/game/settings'
import { normalizeAward, normalizeJoinRequest, normalizeMember, normalizePlayer, normalizePriority, normalizeSettings } from './shared/lib/normalize'
import type { CharacterRequest } from './shared/characters/requests'

export function useGuildData(enabled: boolean, actualRole: GuildRole | null, actualUid: string) {
  const comments = useRosterComments(enabled, actualRole)
  const [roster, setRoster] = useState<PlayerRecord[]>([])
  const [assignments, setAssignments] = useState<Record<string, TeamAssignmentRecord['team']>>({})
  const [priorities, setPriorities] = useState<PriorityRecord[]>([])
  const [awards, setAwards] = useState<AwardRecord[]>([])
  const [afkEntries, setAfkEntries] = useState<AfkEntryRecord[]>([])
  const [raids, setRaids] = useState<RaidRecord[]>([])
  const [raidZones, setRaidZones] = useState<RaidZoneRecord[]>([])
  const [members, setMembers] = useState<MembershipRecord[]>([])
  const [joinRequests, setJoinRequests] = useState<JoinRequestRecord[]>([])
  const [characterRequests, setCharacterRequests] = useState<CharacterRequest[]>([])
  const [characterRequestsLoaded, setCharacterRequestsLoaded] = useState(false)
  const [characterRequestsError, setCharacterRequestsError] = useState('')
  const [dataError, setDataError] = useState('')
  const [settings, setSettings] = useState<GuildSettings>(defaultGuildSettings)
  // How many documents each normalized collection skipped in its latest snapshot.
  const [unreadableByCollection, setUnreadableByCollection] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!enabled) return
    const onError = (error: Error) => setDataError(error.message)
    const countUnreadable = (name: string, dropped: number) => setUnreadableByCollection((current) => current[name] === dropped ? current : { ...current, [name]: dropped })
    const unsubscribers = [
      subscribeGuildCollection<PlayerRecord>('roster', (records, dropped) => { setRoster(records); countUnreadable('roster', dropped) }, onError, normalizePlayer),
      // Settings are cosmetic: if they cannot be read (rules not deployed yet), keep the defaults instead of showing an error.
      subscribeGuildCollection<GuildSettingsRecord>('settings', (records) => setSettings(resolveGuildSettings(records.find((record) => record.id === 'general'))), (error) => console.warn(`settings: ${error.message}`), normalizeSettings),
      subscribeGuildCollection<TeamAssignmentRecord>('teamAssignments', (records) => setAssignments(Object.fromEntries(records.map(({ id, team }) => [id, team]))), onError),
      subscribeGuildCollection<PriorityRecord>('lootPriorities', (records, dropped) => { setPriorities(records); countUnreadable('lootPriorities', dropped) }, onError, normalizePriority),
      subscribeGuildCollection<AwardRecord>('awards', (records, dropped) => { setAwards(records.sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))); countUnreadable('awards', dropped) }, onError, normalizeAward),
      subscribeGuildCollection<AfkEntryRecord>('afkEntries', (records) => setAfkEntries(records.sort((a, b) => a.startDate.localeCompare(b.startDate))), onError),
      subscribeGuildCollection<RaidRecord>('raids', (records) => setRaids(records.sort((a, b) => a.date.localeCompare(b.date))), onError),
      subscribeRaidZones((records) => setRaidZones(records.sort((a, b) => a.name.localeCompare(b.name))), onError),
      subscribeCharacterRequests(actualUid, actualRole === 'Guild Leader', (records) => {
        setCharacterRequests(records)
        setCharacterRequestsLoaded(true)
      }, (error) => setCharacterRequestsError(error.message)),
    ]
    if (actualRole === 'Guild Leader') {
      unsubscribers.push(subscribeGuildCollection<MembershipRecord>('members', (records, dropped) => { setMembers(records); countUnreadable('members', dropped) }, onError, normalizeMember))
      unsubscribers.push(subscribeGuildCollection<JoinRequestRecord>('joinRequests', (requests, dropped) => { setJoinRequests(requests.filter((request) => request.status === 'pending')); countUnreadable('joinRequests', dropped) }, onError, normalizeJoinRequest))
    }
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      setRoster([])
      setAssignments({})
      setPriorities([])
      setAwards([])
      setAfkEntries([])
      setRaids([])
      setRaidZones([])
      setMembers([])
      setJoinRequests([])
      setCharacterRequests([])
      setCharacterRequestsLoaded(false)
      setCharacterRequestsError('')
      setSettings(defaultGuildSettings)
      setDataError('')
      setUnreadableByCollection({})
    }
  }, [enabled, actualRole, actualUid])

  // `priorities` is the current phase's list, which is what the dashboard, the counters and Browse drops want; `allPriorities` holds every
  // phase (the Loot priorities tab picks one). See shared/game/phases.ts.
  const phaseNow = currentPhaseNo(settings)
  // A priority taken off the list (hidden) is kept but left out of everything: `hiddenPriorities` has them, for Browse drops to bring back.
  const visiblePriorities = useMemo(() => priorities.filter((priority) => !priority.hidden), [priorities])
  const hiddenPriorities = useMemo(() => priorities.filter((priority) => priority.hidden), [priorities])
  const currentPriorities = useMemo(() => visiblePriorities.filter((priority) => phaseNoOf(priority) === phaseNow), [visiblePriorities, phaseNow])

  return {
    comments,
    roster,
    assignments,
    priorities: currentPriorities,
    allPriorities: visiblePriorities,
    hiddenPriorities,
    awards,
    afkEntries,
    raids,
    raidZones,
    settings,
    members: actualRole === 'Guild Leader' ? members : [],
    joinRequests: actualRole === 'Guild Leader' ? joinRequests : [],
    characterRequests,
    characterRequestsLoaded,
    characterRequestsError,
    dataError,
    // Documents in roster, lootPriorities, awards (and members and joinRequests for a Guild Leader) that
    // could not be read and were skipped. Show it to leaders only.
    unreadable: Object.values(unreadableByCollection).reduce((total, count) => total + count, 0),
  }
}
