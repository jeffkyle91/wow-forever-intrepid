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
import type { LootTableDoc } from './shared/game/guildTables'
import { currentPhaseNo, phaseNoOf } from './shared/game/phases'
import { listZones, schedulableZones } from './shared/game/zoneList'
import { dropTables } from './shared/lib/dropTables'
import { defaultGuildSettings, resolveGuildSettings } from './shared/game/settings'
import { readZoneColors } from './shared/game/zoneColors'
import { normalizeAward, normalizeJoinRequest, normalizeLootTable, normalizeMember, normalizePlayer, normalizePriority, normalizeSettings } from './shared/lib/normalize'
import type { CharacterRequest } from './shared/characters/requests'
import { normalizeReadiness, type CharacterReadiness } from './shared/members/readiness'

export function useGuildData(enabled: boolean, actualRole: GuildRole | null, actualUid: string) {
  const comments = useRosterComments(enabled, actualRole)
  const [roster, setRoster] = useState<PlayerRecord[]>([])
  const [readiness, setReadiness] = useState<CharacterReadiness[]>([])
  const [readinessLoaded, setReadinessLoaded] = useState(false)
  const [readinessError, setReadinessError] = useState('')
  const [leadershipLoaded, setLeadershipLoaded] = useState<string[]>([])
  const [assignments, setAssignments] = useState<Record<string, TeamAssignmentRecord['team']>>({})
  const [priorities, setPriorities] = useState<PriorityRecord[]>([])
  const [awards, setAwards] = useState<AwardRecord[]>([])
  const [lootTables, setLootTables] = useState<LootTableDoc[]>([])
  const [zoneColors, setZoneColors] = useState<Record<string, string>>({})
  const [afkEntries, setAfkEntries] = useState<AfkEntryRecord[]>([])
  const [raids, setRaids] = useState<RaidRecord[]>([])
  const [raidZoneCatalog, setRaidZoneCatalog] = useState<RaidZoneRecord[]>([])
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
      subscribeGuildCollection<PlayerRecord>('roster', (records, dropped) => { setRoster(records); countUnreadable('roster', dropped); setLeadershipLoaded((loaded) => [...new Set([...loaded, 'roster'])]) }, onError, normalizePlayer),
      subscribeGuildCollection<CharacterReadiness>('characterReadiness', (records, dropped) => {
        setReadiness(records)
        setReadinessLoaded(true)
        setReadinessError(dropped ? 'Some raid-readiness records could not be read. Ask a Guild Leader to check them.' : '')
      }, (error) => setReadinessError(error.message), normalizeReadiness, true),
      // Settings are cosmetic: if they cannot be read (rules not deployed yet), keep the defaults instead of showing an error.
      subscribeGuildCollection<GuildSettingsRecord>('settings', (records) => setSettings(resolveGuildSettings(records.find((record) => record.id === 'general'))), (error) => console.warn(`settings: ${error.message}`), normalizeSettings),
      subscribeGuildCollection<TeamAssignmentRecord>('teamAssignments', (records) => { setAssignments(Object.fromEntries(records.map(({ id, team }) => [id, team]))); setLeadershipLoaded((loaded) => [...new Set([...loaded, 'assignments'])]) }, onError),
      subscribeGuildCollection<PriorityRecord>('lootPriorities', (records, dropped) => { setPriorities(records); countUnreadable('lootPriorities', dropped) }, onError, normalizePriority),
      // The guild's own drop lists are an addition to the built-in ones: if they cannot be read (rules not deployed yet), the built-in lists still work.
      // The colors the guild chose for zones are one document of the settings collection; without it (or before the rules allow it) every zone has its default color.
      subscribeGuildCollection<{ id: string; colors: unknown }>('settings', (records) => setZoneColors(readZoneColors(records.find((record) => record.id === 'zoneColors')?.colors)), (error) => console.warn(`zone colors: ${error.message}`), (id, data) => ({ id, colors: id === 'zoneColors' ? data.colors : undefined })),
      subscribeGuildCollection<LootTableDoc>('lootTables', (records) => setLootTables(records), (error) => console.warn(`lootTables: ${error.message}`), normalizeLootTable),
      subscribeGuildCollection<AwardRecord>('awards', (records, dropped) => { setAwards(records.sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))); countUnreadable('awards', dropped) }, onError, normalizeAward),
      subscribeGuildCollection<AfkEntryRecord>('afkEntries', (records) => setAfkEntries(records.sort((a, b) => a.startDate.localeCompare(b.startDate))), onError),
      subscribeGuildCollection<RaidRecord>('raids', (records) => { setRaids(records.sort((a, b) => a.date.localeCompare(b.date))); setLeadershipLoaded((loaded) => [...new Set([...loaded, 'raids'])]) }, onError),
      subscribeRaidZones((records) => setRaidZoneCatalog(records.sort((a, b) => a.name.localeCompare(b.name))), onError),
      subscribeCharacterRequests(actualUid, actualRole === 'Guild Leader', (records) => {
        setCharacterRequests(records)
        setCharacterRequestsLoaded(true)
      }, (error) => setCharacterRequestsError(error.message)),
    ]
    if (actualRole === 'Guild Leader') {
      unsubscribers.push(subscribeGuildCollection<MembershipRecord>('members', (records, dropped) => { setMembers(records); countUnreadable('members', dropped); setLeadershipLoaded((loaded) => [...new Set([...loaded, 'members'])]) }, onError, normalizeMember))
      unsubscribers.push(subscribeGuildCollection<JoinRequestRecord>('joinRequests', (requests, dropped) => { setJoinRequests(requests.filter((request) => request.status === 'pending')); countUnreadable('joinRequests', dropped) }, onError, normalizeJoinRequest))
    }
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      setRoster([])
      setReadiness([])
      setReadinessLoaded(false)
      setReadinessError('')
      setLeadershipLoaded([])
      setAssignments({})
      setPriorities([])
      setAwards([])
      setLootTables([])
      setZoneColors({})
      setAfkEntries([])
      setRaids([])
      setRaidZoneCatalog([])
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
  // Every zone the guild has (the built-in ones, the ones made in Settings, the older raid zone list) and, of them, the raids a raid night can be scheduled in.
  const zoneList = useMemo(() => listZones(dropTables, lootTables, raidZoneCatalog, phaseNow), [lootTables, raidZoneCatalog, phaseNow])
  const raidZones = useMemo(() => schedulableZones(zoneList), [zoneList])
  // A priority taken off the list (hidden) is kept but left out of everything: `hiddenPriorities` has them, for Browse drops to bring back.
  const visiblePriorities = useMemo(() => priorities.filter((priority) => !priority.hidden), [priorities])
  const hiddenPriorities = useMemo(() => priorities.filter((priority) => priority.hidden), [priorities])
  const currentPriorities = useMemo(() => visiblePriorities.filter((priority) => phaseNoOf(priority) === phaseNow), [visiblePriorities, phaseNow])

  return {
    comments,
    readiness,
    readinessLoaded,
    readinessError,
    leadershipLoaded: ['roster', 'raids', 'members', 'assignments'].every((name) => leadershipLoaded.includes(name)),
    roster,
    assignments,
    priorities: currentPriorities,
    allPriorities: visiblePriorities,
    hiddenPriorities,
    awards,
    lootTables,
    zoneColors,
    afkEntries,
    raids,
    zoneList,
    raidZones,
    raidZoneCatalog,
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
