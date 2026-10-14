// Invented data for the rules tests: who is who, what the seeded guild looks like, and builders for
// the documents the app writes. Every name, uid and e-mail here is made up. Keep it that way: this
// repository is public.
import { doc, serverTimestamp, writeBatch, type DocumentData, type Firestore } from 'firebase/firestore'
import type { GuildRole } from '../../../src/security.ts'

export const GUILD_ID = 'guild-test'
export const OTHER_GUILD_ID = 'guild-other'

/**
 * The people the tests act as. `anonymous` is signed out. `stranger` is signed in with no members doc.
 * `otherGuildLeader` leads a different guild and has no role in this one, which catches rules that
 * check the wrong guild. The last three hold the three roles.
 */
export const PERSONAS = ['anonymous', 'stranger', 'otherGuildLeader', 'member', 'raidLeader', 'guildLeader'] as const
export type Persona = (typeof PERSONAS)[number]
export type SignedInPersona = Exclude<Persona, 'anonymous'>

export const UID: Record<SignedInPersona, string> = {
  stranger: 'uid-stranger',
  otherGuildLeader: 'uid-other-guild-leader',
  member: 'uid-member',
  raidLeader: 'uid-raid-leader',
  guildLeader: 'uid-guild-leader',
}

/** People who exist in the seed but are nobody's persona: "someone else" in tests of other people's data. */
export const BYSTANDER = 'uid-bystander' // a seeded Member
export const APPLICANT = 'uid-applicant' // has a pending join request and no members doc
export const NEWCOMER = 'uid-newcomer' // exists nowhere

/** How tests refer to each persona in prose. */
export const LABEL: Record<Persona, string> = {
  anonymous: 'signed-out visitor',
  stranger: 'stranger',
  otherGuildLeader: "other guild's leader",
  member: 'Member',
  raidLeader: 'Raid Leader',
  guildLeader: 'Guild Leader',
}

/** A uid for any persona, including the signed-out one, so row builders can always make a path. */
export const uidOf = (who: Persona): string => (who === 'anonymous' ? 'uid-anonymous' : UID[who])

/** The groups the rules talk about, as persona lists. */
export const ANY_ROLE: readonly Persona[] = ['member', 'raidLeader', 'guildLeader']
export const RAID_STAFF: readonly Persona[] = ['raidLeader', 'guildLeader']
export const LEADER_ONLY: readonly Persona[] = ['guildLeader']
export const SIGNED_IN: readonly Persona[] = ['stranger', 'otherGuildLeader', 'member', 'raidLeader', 'guildLeader']

export const displayNameOf = (uid: string): string => `Test ${uid.replace(/^uid-/, '')}`
const emailOf = (uid: string): string => `${uid.replace(/^uid-/, '')}@example.test`

export const PLAYER_1 = 'player-1'
export const PLAYER_2 = 'player-2'
export const PLAYER_3 = 'player-3'
export const PRIORITY_ID = 'priority-1'

/** A copy of a document without some keys, for payloads that must leave a field out. */
export function without(data: DocumentData, ...keys: string[]): DocumentData {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)))
}

// ---- documents as the app writes them (src/guildApi.ts). Overrides win, so a test can break one field.

export function memberDoc(uid: string, role: GuildRole, playerId: string | null = null, overrides: DocumentData = {}): DocumentData {
  return { email: emailOf(uid), displayName: displayNameOf(uid), role, playerId, joinedAt: serverTimestamp(), ...overrides }
}

export function rosterDoc(n: number | string, overrides: DocumentData = {}): DocumentData {
  return { name: `Test Character ${n}`, className: 'Warrior', specialization: 'Arms', role: 'Melee', ...overrides }
}

export function priorityDoc(overrides: DocumentData = {}): DocumentData {
  return {
    item: 'Test Sword',
    encounter: 'Test Boss',
    rankedPlayers: [PLAYER_1, PLAYER_2, PLAYER_3],
    councilNote: 'Test council note',
    ...overrides,
  }
}

/** An award that matches the seeded priority exactly, which is what the Raid Leader branch requires. */
export function awardDoc(overrides: DocumentData = {}): DocumentData {
  const priority = priorityDoc()
  return {
    priorityId: PRIORITY_ID,
    item: priority.item,
    encounter: priority.encounter,
    recipient: PLAYER_2,
    awardedAt: '2026-12-09',
    prioritySnapshot: priority.rankedPlayers,
    councilNoteSnapshot: priority.councilNote,
    awardNote: '',
    ...overrides,
  }
}

export function afkDoc(uid: string, overrides: DocumentData = {}): DocumentData {
  return { userId: uid, displayName: displayNameOf(uid), startDate: '2026-12-10', endDate: '2026-12-12', createdAt: serverTimestamp(), ...overrides }
}

export function raidDoc(uid: string, overrides: DocumentData = {}): DocumentData {
  return { date: '2026-12-09', name: 'Test Raid', size: 20, createdBy: uid, createdAt: serverTimestamp(), ...overrides }
}

/** A join request as submitJoinRequest writes it. */
export function joinRequestDoc(uid: string, overrides: DocumentData = {}): DocumentData {
  return { userId: uid, email: emailOf(uid), displayName: displayNameOf(uid), status: 'pending', requestedAt: serverTimestamp(), ...overrides }
}

/** The fields approveJoinRequest needs from a request. */
export function requestOf(uid: string): { userId: string; email: string; displayName: string } {
  return { userId: uid, email: emailOf(uid), displayName: displayNameOf(uid) }
}

/**
 * The guild every test starts from. Written with security rules off, in one batch.
 *
 * guild-test: a Guild Leader, a Raid Leader, a Member and a bystander Member (none linked to a roster
 * character), roster player-1..3, one team assignment, one loot priority, one award that matches it,
 * one availability entry per signed-in persona plus one for the bystander, one raid, and a pending
 * join request from the applicant. guild-other: its own leader and roster.
 */
export async function seedBaseline(db: Firestore): Promise<void> {
  const batch = writeBatch(db)
  const set = (path: string, data: DocumentData) => batch.set(doc(db, path), data)
  const g = `guilds/${GUILD_ID}`

  set(g, { name: 'Test Guild' })
  set(`${g}/members/${UID.guildLeader}`, memberDoc(UID.guildLeader, 'Guild Leader'))
  set(`${g}/members/${UID.raidLeader}`, memberDoc(UID.raidLeader, 'Raid Leader'))
  set(`${g}/members/${UID.member}`, memberDoc(UID.member, 'Member'))
  set(`${g}/members/${BYSTANDER}`, memberDoc(BYSTANDER, 'Member'))
  for (const [i, id] of [PLAYER_1, PLAYER_2, PLAYER_3].entries()) set(`${g}/roster/${id}`, rosterDoc(i + 1))
  set(`${g}/teamAssignments/${PLAYER_1}`, { team: 'blue' })
  set(`${g}/lootPriorities/${PRIORITY_ID}`, priorityDoc())
  set(`${g}/awards/award-1`, awardDoc())
  for (const persona of Object.keys(UID) as SignedInPersona[]) set(`${g}/afkEntries/afk-${persona}`, afkDoc(UID[persona]))
  set(`${g}/afkEntries/afk-bystander`, afkDoc(BYSTANDER))
  set(`${g}/raids/raid-1`, raidDoc(UID.raidLeader))
  set(`${g}/joinRequests/${APPLICANT}`, joinRequestDoc(APPLICANT))

  const other = `guilds/${OTHER_GUILD_ID}`
  set(other, { name: 'Other Guild' })
  set(`${other}/members/${UID.otherGuildLeader}`, memberDoc(UID.otherGuildLeader, 'Guild Leader'))
  set(`${other}/roster/${PLAYER_1}`, rosterDoc(1))
  await batch.commit()
}
