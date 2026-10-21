import type { Timestamp } from 'firebase/firestore'

const lineupKeys = {
  10: ['blue', 'yellow', 'red', 'white'],
  20: ['green', 'pink'],
  40: ['brown'],
} as const
const signupStatuses = ['accept', 'tentative', 'absent', 'late', 'bench'] as const

type UnknownRecord = Record<string, unknown>

export class SnapshotDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotDataError'
  }
}

export type SnapshotManifest = {
  raidId: string
  raid: { name: string; date: string }
  scheduledStartAt: Timestamp
  capturedAt: Timestamp
  lineupSizes: (10 | 20 | 40)[]
  counts: { lineups: number; characters: number; accounts: number }
}

export type SnapshotTeam = { key: string; name: string; characterIds: string[] }
export type SnapshotLineup = { size: 10 | 20 | 40; teams: SnapshotTeam[]; bench: string[] }

export type SnapshotReport = {
  id: string
  snapshotPath: string
  raidId: string
  raidName: string
  scheduledStartAt: Timestamp
  capturedAt: Timestamp
  label: string
  size: 10 | 20 | 40
  expectedAccountCount: number
  teamKey: string
  teamName: string
  characterIds: string[]
  benchIds: string[]
}

export type SnapshotPlacement = {
  size: 10 | 20 | 40
  teamKey: string | null
  teamName: string | null
  bench: boolean
}

export type SnapshotCharacter = {
  id: string
  name: string | null
  surname: string | null
  className: string | null
  specialization: string | null
  role: string | null
  accountUid: string | null
  placements: SnapshotPlacement[]
}

export type SnapshotAccount = {
  uid: string
  displayName: string | null
  invited: boolean
  invitationOrder: number | null
  invitationMainId: string | null
  signup: { characterId: string; status: typeof signupStatuses[number]; benchKind?: 'self' } | null
}

export type SnapshotReportRoster = { team: SnapshotCharacter[]; bench: SnapshotCharacter[] }
export type SnapshotInvitationRow = {
  account: SnapshotAccount
  invitationCharacter: SnapshotCharacter | null
  signupCharacter: SnapshotCharacter | null
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value) throw new SnapshotDataError(`Snapshot ${field} is missing or invalid.`)
  return value
}

function nullableString(value: unknown, field: string) {
  if (value === null) return null
  if (typeof value !== 'string') throw new SnapshotDataError(`Snapshot ${field} is invalid.`)
  return value
}

function characterIds(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) {
    throw new SnapshotDataError(`Snapshot ${field} is missing or invalid.`)
  }
  if (new Set(value).size !== value.length) throw new SnapshotDataError(`Snapshot ${field} contains duplicate characters.`)
  return [...value]
}

export function readSnapshotManifest(raidId: string, value: unknown): SnapshotManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.status !== 'complete' || value.raidId !== raidId
    || !isRecord(value.raid) || !Array.isArray(value.lineupSizes) || !isRecord(value.counts)
    || !(value.scheduledStartAt && typeof value.scheduledStartAt === 'object'
      && 'toMillis' in value.scheduledStartAt && typeof value.scheduledStartAt.toMillis === 'function')
    || !(value.capturedAt && typeof value.capturedAt === 'object'
      && 'toMillis' in value.capturedAt && typeof value.capturedAt.toMillis === 'function')) {
    throw new SnapshotDataError('Published snapshot manifest is missing required data.')
  }
  const date = requiredString(value.raid.date, 'raid date')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) {
    throw new SnapshotDataError('Snapshot raid date is invalid.')
  }
  const lineupSizes = value.lineupSizes
  if (lineupSizes.some((size) => size !== 10 && size !== 20 && size !== 40)
    || new Set(lineupSizes).size !== lineupSizes.length || !lineupSizes.length) {
    throw new SnapshotDataError('Snapshot lineup sizes are missing or invalid.')
  }
  const counts = value.counts
  const lineupsCount = counts.lineups
  const characterCount = counts.characters
  const accountCount = counts.accounts
  if (lineupsCount !== lineupSizes.length
    || typeof characterCount !== 'number' || !Number.isSafeInteger(characterCount) || characterCount < 0
    || typeof accountCount !== 'number' || !Number.isSafeInteger(accountCount) || accountCount < 0) {
    throw new SnapshotDataError('Snapshot record counts are missing or invalid.')
  }
  const scheduledStartAt = value.scheduledStartAt as Timestamp
  const capturedAt = value.capturedAt as Timestamp
  return {
    raidId,
    raid: { name: requiredString(value.raid.name, 'raid name'), date },
    scheduledStartAt,
    capturedAt,
    lineupSizes: [...lineupSizes] as (10 | 20 | 40)[],
    counts: { lineups: lineupSizes.length, characters: characterCount, accounts: accountCount },
  }
}

export function readSnapshotLineup(size: 10 | 20 | 40, value: unknown): SnapshotLineup {
  if (!isRecord(value) || value.size !== size || !Array.isArray(value.teams)) {
    throw new SnapshotDataError(`Published ${size}M lineup is incomplete.`)
  }
  const expectedKeys = lineupKeys[size]
  const teams: SnapshotTeam[] = value.teams.map((team) => {
    if (!isRecord(team) || typeof team.key !== 'string' || typeof team.name !== 'string') {
      throw new SnapshotDataError(`Published ${size}M team data is incomplete.`)
    }
    if (!new Set<string>(expectedKeys).has(team.key)) throw new SnapshotDataError(`Published ${size}M lineup has an unknown team.`)
    return { key: team.key, name: team.name, characterIds: characterIds(team.characterIds, `${size}M team`) }
  })
  if (teams.length !== expectedKeys.length || expectedKeys.some((key) => teams.filter((team) => team.key === key).length !== 1)) {
    throw new SnapshotDataError(`Published ${size}M lineup has missing or duplicate teams.`)
  }
  const bench = characterIds(value.bench, `${size}M bench`)
  const teamCharacterIds = teams.flatMap((team) => team.characterIds)
  const placed = new Set(teamCharacterIds)
  if (placed.size !== teamCharacterIds.length || bench.some((id) => placed.has(id))) {
    throw new SnapshotDataError(`Published ${size}M lineup has duplicate team/bench placements.`)
  }
  return { size, teams, bench }
}

function formattedDate(date: string) {
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) ?? []
  if (!year || !month || !day) throw new SnapshotDataError('Snapshot raid date cannot be formatted.')
  return `${month}-${day}-${year.slice(-2)}`
}

export function buildSnapshotReports(snapshotPath: string, manifest: SnapshotManifest, lineups: SnapshotLineup[]) {
  const bySize = new Map(lineups.map((lineup) => [lineup.size, lineup]))
  if (bySize.size !== manifest.lineupSizes.length || manifest.lineupSizes.some((size) => !bySize.has(size))) {
    throw new SnapshotDataError('Published snapshot is missing one or more lineup records.')
  }
  const reports = manifest.lineupSizes.flatMap((size) => {
    const lineup = bySize.get(size)
    if (!lineup) throw new SnapshotDataError(`Published ${size}M lineup is missing.`)
    return lineup.teams.map((team) => ({
      id: `${manifest.raidId}:${size}:${team.key}`,
      snapshotPath,
      raidId: manifest.raidId,
      raidName: manifest.raid.name,
      scheduledStartAt: manifest.scheduledStartAt,
      capturedAt: manifest.capturedAt,
      label: `${formattedDate(manifest.raid.date)} ${team.name} ${size}M`,
      size,
      expectedAccountCount: manifest.counts.accounts,
      teamKey: team.key,
      teamName: team.name,
      characterIds: [...team.characterIds],
      benchIds: [...lineup.bench],
    }))
  })
  return sortSnapshotReports(reports)
}

export function sortSnapshotReports(reports: SnapshotReport[]) {
  const teamOrder = new Map<string, number>(Object.values(lineupKeys).flatMap((keys) => keys.map((key, index) => [key, index] as const)))
  return [...reports].sort((left, right) =>
    right.scheduledStartAt.toMillis() - left.scheduledStartAt.toMillis()
    || left.size - right.size
    || (teamOrder.get(left.teamKey) ?? 0) - (teamOrder.get(right.teamKey) ?? 0)
    || left.raidId.localeCompare(right.raidId))
}

export function readSnapshotCharacter(id: string, value: unknown): SnapshotCharacter {
  if (!isRecord(value) || value.id !== id || !Array.isArray(value.placements)) {
    throw new SnapshotDataError(`Snapshot character ${id} is missing or incomplete.`)
  }
  const placements = value.placements.map((placement) => {
    if (!isRecord(placement) || (placement.size !== 10 && placement.size !== 20 && placement.size !== 40)
      || typeof placement.bench !== 'boolean'
      || (placement.teamKey !== null && typeof placement.teamKey !== 'string')
      || (placement.teamName !== null && typeof placement.teamName !== 'string')) {
      throw new SnapshotDataError(`Snapshot placement for ${id} is incomplete.`)
    }
    return {
      size: placement.size,
      teamKey: placement.teamKey,
      teamName: placement.teamName,
      bench: placement.bench,
    } as SnapshotPlacement
  })
  if (new Set(placements.map(({ size }) => size)).size !== placements.length
    || placements.some(({ bench, teamKey, teamName }) => bench ? teamKey !== null || teamName !== null : teamKey === null || teamName === null)) {
    throw new SnapshotDataError(`Snapshot placements for ${id} are duplicated or inconsistent.`)
  }
  return {
    id,
    name: nullableString(value.name, `${id} name`),
    surname: nullableString(value.surname, `${id} surname`),
    className: nullableString(value.className, `${id} class`),
    specialization: nullableString(value.specialization, `${id} specialization`),
    role: nullableString(value.role, `${id} role`),
    accountUid: nullableString(value.accountUid, `${id} account link`),
    placements,
  }
}

export function buildSnapshotReportRoster(report: SnapshotReport, characters: Map<string, SnapshotCharacter>): SnapshotReportRoster {
  const allIds = [...report.characterIds, ...report.benchIds]
  if (new Set(allIds).size !== allIds.length) throw new SnapshotDataError('Snapshot report contains duplicate team/bench assignments.')
  const getCharacter = (id: string, bench: boolean) => {
    const character = characters.get(id)
    if (!character) throw new SnapshotDataError(`Snapshot character ${id} is missing from the published report.`)
    const placed = character.placements.some((entry) => entry.size === report.size
      && entry.bench === bench
      && (bench
        ? entry.teamKey === null && entry.teamName === null
        : entry.teamKey === report.teamKey && entry.teamName === report.teamName))
    if (!placed) throw new SnapshotDataError(`Snapshot placement for ${character.name ?? id} does not match the published lineup.`)
    return character
  }
  return {
    team: report.characterIds.map((id) => getCharacter(id, false)),
    bench: report.benchIds.map((id) => getCharacter(id, true)),
  }
}

export function readSnapshotAccount(uid: string, value: unknown): SnapshotAccount {
  if (!isRecord(value) || value.uid !== uid || typeof value.invited !== 'boolean') {
    throw new SnapshotDataError(`Snapshot account ${uid} is missing or incomplete.`)
  }
  const invitationOrder = value.invitationOrder
  if (invitationOrder !== null && (typeof invitationOrder !== 'number'
    || !Number.isSafeInteger(invitationOrder) || invitationOrder < 0)) {
    throw new SnapshotDataError(`Snapshot invitation order for ${uid} is invalid.`)
  }
  const invitationMainId = value.invitationMainId === null ? null : requiredString(value.invitationMainId, `${uid} invitation character`)
  let signup: SnapshotAccount['signup'] = null
  if (value.signup !== null) {
    if (!isRecord(value.signup) || !signupStatuses.includes(value.signup.status as typeof signupStatuses[number])) {
      throw new SnapshotDataError(`Snapshot signup for ${uid} is missing or invalid.`)
    }
    signup = {
      characterId: requiredString(value.signup.characterId, `${uid} signup character`),
      status: value.signup.status as typeof signupStatuses[number],
      ...(value.signup.benchKind === 'self' ? { benchKind: 'self' as const } : {}),
    }
    if (value.signup.benchKind !== undefined && value.signup.benchKind !== 'self') {
      throw new SnapshotDataError(`Snapshot signup for ${uid} has an invalid bench type.`)
    }
  }
  if (value.invited && (invitationMainId === null || typeof invitationOrder !== 'number')) {
    throw new SnapshotDataError(`Snapshot invitation for ${uid} is incomplete.`)
  }
  return {
    uid,
    displayName: nullableString(value.displayName, `${uid} display name`),
    invited: value.invited,
    invitationOrder,
    invitationMainId,
    signup,
  }
}

export function buildSnapshotInvitationRows(accounts: SnapshotAccount[], characters: Map<string, SnapshotCharacter>) {
  const rows = accounts.map((account): SnapshotInvitationRow => {
    const invitationCharacter = account.invitationMainId ? characters.get(account.invitationMainId) : null
    const signupCharacter = account.signup ? characters.get(account.signup.characterId) : null
    if (account.invitationMainId && !invitationCharacter) {
      throw new SnapshotDataError(`Invited character ${account.invitationMainId} is missing from the published snapshot.`)
    }
    if (account.signup && !signupCharacter) {
      throw new SnapshotDataError(`Signup character ${account.signup.characterId} is missing from the published snapshot.`)
    }
    return { account, invitationCharacter: invitationCharacter ?? null, signupCharacter: signupCharacter ?? null }
  })
  return rows.sort((left, right) =>
    Number(right.account.invited) - Number(left.account.invited)
    || (left.account.invitationOrder ?? Number.MAX_SAFE_INTEGER) - (right.account.invitationOrder ?? Number.MAX_SAFE_INTEGER)
    || (left.account.displayName ?? left.account.uid).localeCompare(right.account.displayName ?? right.account.uid))
}
