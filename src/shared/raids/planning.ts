import type { PlayerRecord } from '../game/players.ts'
import { samePlayer } from '../game/teams.ts'
import type { RaidSignup } from '../../raidSignups.ts'
import type { StandingTeam } from '../../guildApi.ts'

export type ScheduledTeam = { key: StandingTeam; name: string; characterIds: string[] }
export type ScheduledLineup = { size: 10 | 20 | 40; teams: ScheduledTeam[]; bench: string[] }
export type RaidInvitation = { uid: string; mainId: string }
export type ScheduledRoster = { schemaVersion: 1; revision: number; invitations: RaidInvitation[]; lineups: ScheduledLineup[] }
type Readiness = { id: string; ready: boolean }
type Absence = { userId: string; startDate: string; endDate: string }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 1500 && !value.includes('/')
const identifiers = (value: unknown): value is string[] => Array.isArray(value) && value.every(identifier) && new Set(value).size === value.length
const keysBySize = { 10: ['blue', 'yellow', 'red', 'white'], 20: ['green', 'pink'], 40: ['brown'] } as const
const isSize = (value: unknown): value is 10 | 20 | 40 => value === 10 || value === 20 || value === 40

export function readScheduledRoster(value: unknown): ScheduledRoster | null {
  if (!object(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || typeof value.revision !== 'number' || value.revision < 1
    || !Array.isArray(value.invitations) || !Array.isArray(value.lineups) || value.lineups.length !== 3) return null
  const invitations: RaidInvitation[] = []
  for (const entry of value.invitations) {
    if (!object(entry) || !identifier(entry.uid) || !identifier(entry.mainId) || invitations.some((invited) => invited.uid === entry.uid)) return null
    invitations.push({ uid: entry.uid, mainId: entry.mainId })
  }
  const lineups: ScheduledLineup[] = []
  for (const entry of value.lineups) {
    if (!object(entry) || !isSize(entry.size) || !Array.isArray(entry.teams) || !identifiers(entry.bench) || lineups.some((lineup) => lineup.size === entry.size)) return null
    const keys: readonly StandingTeam[] = keysBySize[entry.size]
    if (entry.teams.length !== keys.length) return null
    const teams: ScheduledTeam[] = []
    for (const team of entry.teams) {
      if (!object(team)) return null
      const key = keys.find((key) => key === team.key)
      if (!key || teams.some((existing) => existing.key === team.key)
        || typeof team.name !== 'string' || !team.name.trim() || !identifiers(team.characterIds)) return null
      teams.push({ key, name: team.name, characterIds: team.characterIds })
    }
    const placed = [...teams.flatMap((team) => team.characterIds), ...entry.bench]
    if (new Set(placed).size !== placed.length) return null
    lineups.push({ size: entry.size, teams, bench: entry.bench })
  }
  return { schemaVersion: 1, revision: value.revision, invitations, lineups }
}

export function characterAccount(characterId: string, roster: PlayerRecord[]) {
  const character = roster.find((entry) => entry.id === characterId)
  const main = character?.mainId ? roster.find((entry) => entry.id === character.mainId && !entry.mainId) : character
  if (!character || !main || main.mainId || !main.linkedUid || (character.linkedUid && character.linkedUid !== main.linkedUid)) return undefined
  return { uid: main.linkedUid, main }
}

export function scheduledCandidates(roster: PlayerRecord[], readiness: Readiness[], responses: RaidSignup[]) {
  const ready = new Set(readiness.filter((entry) => entry.ready).map((entry) => entry.id))
  return roster.filter((character) => {
    const account = characterAccount(character.id, roster)
    if (!account || !ready.has(character.id)) return false
    const signup = responses.find((entry) => entry.id === account.uid)
    return character.id === (signup?.characterId ?? account.main.id)
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function scheduledRosterGroups(lineup: ScheduledLineup, invitations: RaidInvitation[], roster: PlayerRecord[], responses: RaidSignup[]) {
  const placed = [...lineup.teams.flatMap((team) => team.characterIds), ...lineup.bench]
  const unassigned = invitations.filter((invitation) => !placed.some((characterId) =>
    characterAccount(characterId, roster)?.uid === invitation.uid || characterId === invitation.mainId))
    .map((invitation) => {
      const selected = responses.find((response) => response.id === invitation.uid)?.characterId
      const main = roster.find((character) => !character.mainId && character.linkedUid === invitation.uid)
      return selected && characterAccount(selected, roster)?.uid === invitation.uid ? selected : main?.id ?? invitation.mainId
    })
  const sorted = (ids: string[]) => [...ids].sort((a, b) =>
    (roster.find((character) => character.id === a)?.name ?? a).localeCompare(roster.find((character) => character.id === b)?.name ?? b))
  return [
    ...lineup.teams.map((team) => ({ ...team, characterIds: sorted(team.characterIds) })),
    { key: 'bench', name: 'Assigned bench', characterIds: sorted(lineup.bench) },
    { key: 'unassigned', name: 'Unassigned invitees', characterIds: sorted(unassigned) },
  ]
}

export function scheduledCharacterResponse(characterId: string, invitations: RaidInvitation[], roster: PlayerRecord[], responses: RaidSignup[]) {
  const uid = characterAccount(characterId, roster)?.uid ?? invitations.find((invitation) => invitation.mainId === characterId)?.uid
  return responses.find((response) => response.id === uid)
}

export function scheduledAvailableCharacters(lineup: ScheduledLineup, invitations: RaidInvitation[], roster: PlayerRecord[], responses: RaidSignup[]) {
  const placed = new Set([...lineup.teams.flatMap((team) => team.characterIds), ...lineup.bench])
  return invitations.flatMap((invitation) => {
    const selected = responses.find((response) => response.id === invitation.uid)?.characterId
    const main = roster.find((character) => !character.mainId && character.linkedUid === invitation.uid)
    const character = selected && characterAccount(selected, roster)?.uid === invitation.uid
      ? roster.find((character) => character.id === selected)
      : main ?? roster.find((character) => character.id === invitation.mainId)
    return character && !placed.has(character.id) ? [character] : []
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function scheduledResponseSummary(characterIds: string[], invitations: RaidInvitation[], roster: PlayerRecord[], responses: RaidSignup[]) {
  const counts = { accept: 0, tentative: 0, absent: 0, late: 0, bench: 0, unanswered: 0 }
  for (const characterId of characterIds) {
    const response = scheduledCharacterResponse(characterId, invitations, roster, responses)
    counts[response?.status ?? 'unanswered']++
  }
  return [
    `${counts.accept} Accepted`, `${counts.tentative} Tentative`, `${counts.absent} Absent`,
    ...(counts.late ? [`${counts.late} Late`] : []),
    ...(counts.bench ? [`${counts.bench} Bench (voluntary)`] : []),
    `${counts.unanswered} Not Responded`,
  ].join(' / ')
}

export function placementWarnings(characterId: string, roster: PlayerRecord[], readiness: Readiness[], responses: RaidSignup[], absences: Absence[], date: string) {
  const warnings: string[] = []
  const character = roster.find((entry) => entry.id === characterId)
  if (!character) return ['Character no longer on roster']
  if (!readiness.some((entry) => entry.id === characterId && entry.ready)) warnings.push('Character not raid ready')
  const account = characterAccount(characterId, roster)
  if (!account) return [...warnings, 'No consistent member link; leader review needed']
  if (!readiness.some((entry) => entry.id === account.main.id && entry.ready)) warnings.push('Main not raid ready; invitation retained if already invited')
  const response = responses.find((entry) => entry.id === account.uid)
  if (response && response.characterId !== characterId) {
    warnings.push(`Signed up as ${roster.find((entry) => entry.id === response.characterId)?.name ?? 'another character'}; leader must resolve`)
  }
  if (response?.status === 'absent' || absences.some((entry) => entry.userId === account.uid && entry.startDate <= date && date <= entry.endDate)) warnings.push('Absent or unavailable')
  return warnings
}

export function lineupWarnings(lineup: ScheduledLineup, roster: PlayerRecord[]) {
  return lineup.teams.flatMap((team) => {
    const warnings: string[] = []
    if (team.characterIds.length > lineup.size) warnings.push(`${team.name} is over capacity`)
    if (team.characterIds.some((first, index) => team.characterIds.slice(index + 1).some((second) => samePlayer(first, second, roster)))) warnings.push(`${team.name} has multiple characters belonging to one player`)
    return warnings
  })
}
