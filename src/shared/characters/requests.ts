import { Timestamp } from 'firebase/firestore'
import type { PlayerRecord } from '../game/players.ts'

export const characterRequestLabels = {
  'create-alt': 'Add a new alt',
  'link-alt': 'Link an existing character as an alt',
  rename: 'Rename a character',
  'change-spec': 'Change class / specialization',
  'promote-main': 'Promote an alt to main',
} as const
export type CharacterRequestKind = keyof typeof characterRequestLabels
export type CharacterSnapshot = Pick<PlayerRecord, 'name' | 'className' | 'specialization'> & {
  surname: string; role: string; mainId: string | null; linkedUid: string | null
}
export type CharacterProposal =
  | { kind: 'create-alt'; characterId: null; proposed: Pick<CharacterSnapshot, 'name' | 'surname' | 'className' | 'specialization'> }
  | { kind: 'link-alt' | 'promote-main'; characterId: string; proposed: Record<string, never> }
  | { kind: 'rename'; characterId: string; proposed: Pick<CharacterSnapshot, 'name' | 'surname'> }
  | { kind: 'change-spec'; characterId: string; proposed: Pick<CharacterSnapshot, 'className' | 'specialization'> }
export type CharacterRequest = {
  id: string
  userId: string
  displayName: string
  kind: CharacterRequestKind
  characterId: string
  mainId: string
  before: CharacterSnapshot | null
  proposed: Partial<Pick<CharacterSnapshot, 'name' | 'surname' | 'className' | 'specialization' | 'role'>>
  note: string
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  requestedAt: Timestamp
  resolvedBy?: string
  resolvedByName?: string
  resolvedAt?: Timestamp
  resolutionNote?: string
}

export function isCharacterRequestKind(value: string): value is CharacterRequestKind {
  return Object.hasOwn(characterRequestLabels, value)
}

function isSnapshot(value: unknown): value is CharacterSnapshot {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return ['name', 'surname', 'className', 'specialization', 'role'].every((key) => typeof data[key] === 'string')
    && (data.mainId === null || typeof data.mainId === 'string')
    && (data.linkedUid === null || typeof data.linkedUid === 'string')
}

export function normalizeCharacterRequest(id: string, data: Record<string, unknown>): CharacterRequest | null {
  if (!id || !['userId', 'displayName', 'characterId', 'mainId', 'note'].every((key) => typeof data[key] === 'string')
    || typeof data.kind !== 'string' || !isCharacterRequestKind(data.kind)
    || typeof data.status !== 'string' || !['pending', 'approved', 'rejected', 'withdrawn'].includes(data.status)
    || !(data.requestedAt instanceof Timestamp)
    || (data.kind === 'create-alt' ? data.before !== null : !isSnapshot(data.before))
    || !data.proposed || typeof data.proposed !== 'object' || Array.isArray(data.proposed)) return null
  const fields = data.kind === 'create-alt' ? ['name', 'surname', 'className', 'specialization', 'role']
    : data.kind === 'rename' ? ['name', 'surname'] : data.kind === 'change-spec' ? ['className', 'specialization', 'role'] : []
  const proposed = data.proposed as Record<string, unknown>
  if (Object.keys(proposed).length !== fields.length || fields.some((key) => typeof proposed[key] !== 'string')) return null
  if (data.status !== 'pending' && (!(data.resolvedAt instanceof Timestamp)
    || !['resolvedBy', 'resolvedByName', 'resolutionNote'].every((key) => typeof data[key] === 'string'))) return null
  return { ...data, id } as CharacterRequest
}

export function requestCharacterName(request: CharacterRequest) {
  return request.before?.name ?? request.proposed.name ?? request.characterId
}

export function requestMainName(request: CharacterRequest, roster: PlayerRecord[]) {
  const currentMain = roster.find((character) => character.linkedUid === request.userId && !character.mainId)
  if (currentMain) return currentMain.name
  const submittedMain = roster.find((character) => character.id === request.mainId)
  return submittedMain?.name
    ?? (request.characterId === request.mainId ? request.before?.name : undefined)
    ?? 'Main character unavailable'
}

export function eligibleRequestCharacters(roster: PlayerRecord[], uid: string, kind: CharacterRequestKind) {
  const main = roster.find((character) => character.linkedUid === uid && !character.mainId)
  if (!main) return []
  if (kind === 'link-alt') return roster.filter((character) => character.id !== main.id && !character.linkedUid && !character.mainId
    && !roster.some((alt) => alt.mainId === character.id))
  return roster.filter((character) => (kind !== 'promote-main' && character.id === main.id)
    || (character.mainId === main.id && !character.linkedUid))
}
