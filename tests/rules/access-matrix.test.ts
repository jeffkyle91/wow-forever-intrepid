// The access matrix: for every collection under guilds/{guildId}, which persona may get, list, create,
// update or delete, checked against the real firestore.rules in the emulator.
//
// Each row is one operation. `allow` lists the personas the rules let through; every other persona must
// be refused with PERMISSION_DENIED. Rows that list somebody double as their own control: the allowed
// persona sends the same payload as the refused ones, so a refusal cannot be blamed on a bad payload.
// Rows that list `'nobody'` are either unconditional `if false` rules or a variant of an allowed row that
// differs in one way only (someone else's uid, say), so the refusal can only come from that difference.
//
// The data-dependent rules (the roster/member link, award snapshots, availability and raid shape,
// the join-request flow) have their own files. This one is about roles.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { addDoc, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, collection, type Firestore } from 'firebase/firestore'
import {
  ANY_ROLE,
  APPLICANT,
  BYSTANDER,
  GUILD_ID,
  LEADER_ONLY,
  NEWCOMER,
  OTHER_GUILD_ID,
  PERSONAS,
  PLAYER_1,
  PLAYER_2,
  PLAYER_3,
  PRIORITY_ID,
  RAID_STAFF,
  SIGNED_IN,
  afkDoc,
  displayNameOf,
  joinRequestDoc,
  memberDoc,
  raidDoc,
  rosterDoc,
  UID,
  uidOf,
  type Persona,
} from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, outcomeOf, resetData, setUpGuildEmulator } from './support/harness.ts'
import { createAward, createPriority, deletePriority, editPriority, type Staff } from './support/audit.ts'

setUpGuildEmulator()

type Operation = 'get' | 'list' | 'create' | 'update' | 'delete'

/** Loot writes carry an audit entry in the name of whoever writes. A persona that is not staff sends the payload a Raid Leader would, so only its role can refuse it. */
const asStaff = (who: Persona): Staff => (who === 'guildLeader' ? 'guildLeader' : 'raidLeader')

interface Row {
  op: Operation
  /** What the operation does, in words. */
  what: string
  /** The personas the rules let through, or 'nobody'. Everyone else must get PERMISSION_DENIED. */
  allow: readonly Persona[] | 'nobody'
  /**
   * Put the data this attempt needs in place, with the rules off. It runs after the data is reset and
   * before `run`, so it is for rows that write: reads are not reset between personas.
   */
  arrange?: (who: Persona) => Promise<void>
  /** Attempt the operation as `who`. Paths that mention the caller are built from `uidOf(who)`. */
  run: (db: Firestore, who: Persona) => Promise<unknown>
}

/** Every row declared below, so the summary tests at the end can read the grants back. */
const declared: { collection: string; row: Row }[] = []

const label = (allow: Row['allow']): string => (allow === 'nobody' ? 'nobody' : allow.join(', '))

function defineMatrix(collectionName: string, rows: Row[]): void {
  describe(collectionName, () => {
    for (const row of rows) {
      declared.push({ collection: collectionName, row })
      test(`${row.op}: ${row.what} (allowed: ${label(row.allow)})`, async () => {
        const wrong: string[] = []
        for (const [i, who] of PERSONAS.entries()) {
          // An allowed write changes the data, so each persona's attempt starts from the baseline. Reads change nothing.
          if (i > 0 && row.op !== 'get' && row.op !== 'list') await resetData()
          await row.arrange?.(who)
          const expected = row.allow !== 'nobody' && row.allow.includes(who) ? 'allowed' : 'denied'
          const actual = await outcomeOf(row.run(dbFor(who), who))
          if (actual !== expected) wrong.push(`${who}: expected ${expected}, got ${actual}`)
        }
        assert.deepEqual(wrong, [])
      })
    }
  })
}

// match /guilds/{guildId}
// Any of the three roles can read the guild document. Nobody can write it from the client: the guild
// document is created in the Firebase console.
defineMatrix('guild document', [
  { op: 'get', what: 'read the guild document', allow: ANY_ROLE, run: (db) => getDoc(doc(db, `guilds/${GUILD_ID}`)) },
  { op: 'update', what: 'rename the guild', allow: 'nobody', run: (db) => updateDoc(doc(db, `guilds/${GUILD_ID}`), { name: 'Renamed' }) },
  { op: 'delete', what: 'delete the guild document', allow: 'nobody', run: (db) => deleteDoc(doc(db, `guilds/${GUILD_ID}`)) },
])

// match /members/{userId}
// Anyone signed in can read their own members doc (that is how the app learns whether you are in),
// including when it does not exist. Only a Guild Leader can read anyone else's, list them, create or
// change one. Nobody can delete one.
defineMatrix('members', [
  { op: 'get', what: 'read your own members doc', allow: SIGNED_IN, run: (db, who) => getDoc(guildDoc(db, `members/${uidOf(who)}`)) },
  { op: 'get', what: "read someone else's members doc", allow: LEADER_ONLY, run: (db) => getDoc(guildDoc(db, `members/${BYSTANDER}`)) },
  { op: 'list', what: 'list all members', allow: LEADER_ONLY, run: (db) => getDocs(guildCollection(db, 'members')) },
  { op: 'create', what: 'create a members doc', allow: LEADER_ONLY, run: (db) => setDoc(guildDoc(db, `members/${NEWCOMER}`), memberDoc(NEWCOMER, 'Member')) },
  { op: 'update', what: "change someone else's role", allow: LEADER_ONLY, run: (db) => updateDoc(guildDoc(db, `members/${BYSTANDER}`), { role: 'Raid Leader' }) },
  { op: 'delete', what: 'delete a members doc', allow: 'nobody', run: (db) => deleteDoc(guildDoc(db, `members/${BYSTANDER}`)) },
])

// match /roster/{playerId}
// Any role can read the roster. Only a Guild Leader can create, change or delete a character (a linked
// character cannot be deleted; see roster-links.test.ts).
defineMatrix('roster', [
  { op: 'get', what: 'read a character', allow: ANY_ROLE, run: (db) => getDoc(guildDoc(db, `roster/${PLAYER_1}`)) },
  { op: 'list', what: 'list the roster', allow: ANY_ROLE, run: (db) => getDocs(guildCollection(db, 'roster')) },
  { op: 'create', what: 'add a character', allow: LEADER_ONLY, run: (db) => setDoc(guildDoc(db, 'roster/player-9'), rosterDoc(9)) },
  { op: 'update', what: 'edit a character', allow: LEADER_ONLY, run: (db) => updateDoc(guildDoc(db, `roster/${PLAYER_1}`), { name: 'Renamed' }) },
  { op: 'delete', what: 'delete an unlinked character', allow: LEADER_ONLY, run: (db) => deleteDoc(guildDoc(db, `roster/${PLAYER_1}`)) },
])

// match /teamAssignments/{playerId}
// Any role can read the teams. Guild and Raid Leaders can assign, move and unassign characters.
defineMatrix('teamAssignments', [
  { op: 'get', what: 'read an assignment', allow: ANY_ROLE, run: (db) => getDoc(guildDoc(db, `teamAssignments/${PLAYER_1}`)) },
  { op: 'list', what: 'list the assignments', allow: ANY_ROLE, run: (db) => getDocs(guildCollection(db, 'teamAssignments')) },
  { op: 'create', what: 'assign a character to a team', allow: RAID_STAFF, run: (db) => setDoc(guildDoc(db, `teamAssignments/${PLAYER_2}`), { team: 'red' }) },
  { op: 'update', what: 'move a character to another team', allow: RAID_STAFF, run: (db) => setDoc(guildDoc(db, `teamAssignments/${PLAYER_1}`), { team: 'yellow' }) },
  { op: 'delete', what: 'unassign a character', allow: RAID_STAFF, run: (db) => deleteDoc(guildDoc(db, `teamAssignments/${PLAYER_1}`)) },
])

// match /lootPriorities/{priorityId}
// Any role can read the priorities. Guild and Raid Leaders can create, edit and delete them, each together with its audit entry (see priority-audit.test.ts).
defineMatrix('lootPriorities', [
  { op: 'get', what: 'read a priority', allow: ANY_ROLE, run: (db) => getDoc(guildDoc(db, `lootPriorities/${PRIORITY_ID}`)) },
  { op: 'list', what: 'list the priorities', allow: ANY_ROLE, run: (db) => getDocs(guildCollection(db, 'lootPriorities')) },
  { op: 'create', what: 'create a priority', allow: RAID_STAFF, run: (db, who) => createPriority(db, asStaff(who)) },
  {
    op: 'update',
    what: 'reorder a priority',
    allow: RAID_STAFF,
    run: (db, who) => editPriority(db, asStaff(who), { changes: { rankedPlayers: [PLAYER_3, PLAYER_2, PLAYER_1] }, action: 'reorder' }),
  },
  { op: 'delete', what: 'delete a priority', allow: RAID_STAFF, run: (db, who) => deletePriority(db, asStaff(who)) },
])

// match /awards/{awardId}
// Any role can read awards. Guild and Raid Leaders can create them (each must carry a snapshot of the priority and its audit entry;
// see awards.test.ts). Nobody can change or delete one without an audit entry, and nobody can delete one at all.
defineMatrix('awards', [
  { op: 'get', what: 'read an award', allow: ANY_ROLE, run: (db) => getDoc(guildDoc(db, 'awards/award-1')) },
  { op: 'list', what: 'list the awards', allow: ANY_ROLE, run: (db) => getDocs(guildCollection(db, 'awards')) },
  { op: 'create', what: 'record an award that matches its priority', allow: RAID_STAFF, run: (db, who) => createAward(db, asStaff(who)) },
  { op: 'update', what: 'change an award', allow: 'nobody', run: (db) => updateDoc(guildDoc(db, 'awards/award-1'), { awardNote: 'edited' }) },
  { op: 'delete', what: 'delete an award', allow: 'nobody', run: (db) => deleteDoc(guildDoc(db, 'awards/award-1')) },
])

// match /afkEntries/{entryId}  (unavailable dates; the interface calls them the Raid Calendar)
// Any role can read them and add entries for themselves. Entries are never edited. Only the owner can
// delete one, and only while still a member: a leader cannot delete someone else's.
defineMatrix('afkEntries', [
  { op: 'get', what: 'read an entry', allow: ANY_ROLE, run: (db) => getDoc(guildDoc(db, 'afkEntries/afk-bystander')) },
  { op: 'list', what: 'list the entries', allow: ANY_ROLE, run: (db) => getDocs(guildCollection(db, 'afkEntries')) },
  { op: 'create', what: 'add an entry for yourself', allow: 'nobody', run: (db, who) => addDoc(guildCollection(db, 'afkEntries'), afkDoc(uidOf(who))) },
  {
    op: 'create',
    what: 'add an entry for someone else (under your own displayName)',
    allow: 'nobody',
    run: (db, who) => addDoc(guildCollection(db, 'afkEntries'), afkDoc(BYSTANDER, { displayName: displayNameOf(uidOf(who)) })),
  },
  { op: 'update', what: 'edit your own entry', allow: 'nobody', run: (db, who) => updateDoc(guildDoc(db, `afkEntries/afk-${who}`), { endDate: '2026-12-30' }) },
  { op: 'delete', what: 'delete your own entry', allow: 'nobody', run: (db, who) => deleteDoc(guildDoc(db, `afkEntries/afk-${who}`)) },
  { op: 'delete', what: "delete someone else's entry", allow: 'nobody', run: (db) => deleteDoc(guildDoc(db, 'afkEntries/afk-bystander')) },
])

// match /raids/{raidId}
// Any role can read the calendar's raids. Guild and Raid Leaders can schedule one. An edit needs its audit
// entry (raid-edits.test.ts), so a bare update is refused for everyone; a raid is never deleted.
defineMatrix('raids', [
  { op: 'get', what: 'read a raid', allow: ANY_ROLE, run: (db) => getDoc(guildDoc(db, 'raids/raid-1')) },
  { op: 'list', what: 'list the raids', allow: ANY_ROLE, run: (db) => getDocs(guildCollection(db, 'raids')) },
  { op: 'create', what: 'schedule a raid', allow: RAID_STAFF, run: (db, who) => addDoc(guildCollection(db, 'raids'), raidDoc(uidOf(who))) },
  { op: 'update', what: 'edit a raid without its audit entry', allow: 'nobody', run: (db) => updateDoc(guildDoc(db, 'raids/raid-1'), { name: 'Renamed' }) },
  { op: 'delete', what: 'delete a raid', allow: 'nobody', run: (db) => deleteDoc(guildDoc(db, 'raids/raid-1')) },
])

// match /joinRequests/{userId}
// Anyone signed in can read and create their own request, including people who are already members
// (the rules never look at membership here). Only a Guild Leader can read anyone else's, list them, or
// answer one. Nobody can delete one, including the person who filed it. The approve and resubmit flows
// are in membership.test.ts.

/** Give a persona the request they would have after filing one, still pending or already rejected by a leader. */
const seedOwnRequest = (who: Persona, status: 'pending' | 'rejected') =>
  asAdmin((db) => setDoc(guildDoc(db, `joinRequests/${uidOf(who)}`), joinRequestDoc(uidOf(who), { status })))

defineMatrix('joinRequests', [
  { op: 'get', what: 'read your own request', allow: SIGNED_IN, run: (db, who) => getDoc(guildDoc(db, `joinRequests/${uidOf(who)}`)) },
  { op: 'get', what: "read someone else's request", allow: LEADER_ONLY, run: (db) => getDoc(guildDoc(db, `joinRequests/${APPLICANT}`)) },
  { op: 'list', what: 'list all requests', allow: LEADER_ONLY, run: (db) => getDocs(guildCollection(db, 'joinRequests')) },
  {
    op: 'create',
    what: 'file a request for yourself',
    allow: SIGNED_IN,
    run: (db, who) => setDoc(guildDoc(db, `joinRequests/${uidOf(who)}`), joinRequestDoc(uidOf(who))),
  },
  {
    op: 'create',
    what: "file a request at someone else's path (naming yourself inside)",
    allow: 'nobody',
    run: (db, who) => setDoc(guildDoc(db, `joinRequests/${NEWCOMER}`), joinRequestDoc(uidOf(who))),
  },
  { op: 'update', what: 'reject a pending request', allow: LEADER_ONLY, run: (db) => updateDoc(guildDoc(db, `joinRequests/${APPLICANT}`), { status: 'rejected' }) },
  { op: 'delete', what: "delete someone else's request", allow: 'nobody', run: (db) => deleteDoc(guildDoc(db, `joinRequests/${APPLICANT}`)) },
  {
    op: 'delete',
    what: 'delete your own pending request',
    allow: 'nobody',
    arrange: (who) => seedOwnRequest(who, 'pending'),
    run: (db, who) => deleteDoc(guildDoc(db, `joinRequests/${uidOf(who)}`)),
  },
  {
    op: 'delete',
    what: 'delete your own rejected request',
    allow: 'nobody',
    arrange: (who) => seedOwnRequest(who, 'rejected'),
    run: (db, who) => deleteDoc(guildDoc(db, `joinRequests/${uidOf(who)}`)),
  },
])

// What the tables above grant, read back. These do not touch the emulator: they pin the shape of the
// grants, so widening a row (or adding one) shows up as a one-line change in review.
const grantedTo = (who: Persona, ops: readonly Operation[]): string[] =>
  declared
    .filter(({ row }) => row.allow !== 'nobody' && row.allow.includes(who) && ops.includes(row.op))
    .map(({ collection: name, row }) => `${name}.${row.op}: ${row.what}`)

const READS: readonly Operation[] = ['get', 'list']
const WRITES: readonly Operation[] = ['create', 'update', 'delete']

describe('what each persona is granted', () => {
  test('a signed-out visitor is granted nothing', () => {
    assert.deepEqual(grantedTo('anonymous', [...READS, ...WRITES]), [])
  })

  test('a signed-in stranger can only read their own members doc and file their own join request', () => {
    // Not "denied everywhere": the app needs the first to learn it has no membership, the second to ask for access.
    assert.deepEqual(grantedTo('stranger', [...READS, ...WRITES]), [
      'members.get: read your own members doc',
      'joinRequests.get: read your own request',
      'joinRequests.create: file a request for yourself',
    ])
  })

  test('a leader of another guild is granted exactly what a stranger is', () => {
    assert.deepEqual(grantedTo('otherGuildLeader', [...READS, ...WRITES]), grantedTo('stranger', [...READS, ...WRITES]))
  })

  test('a Member writes availability through callables, not directly', () => {
    assert.deepEqual(grantedTo('member', WRITES), [
      'joinRequests.create: file a request for yourself',
    ])
  })

  test('a Raid Leader writes what a Member does, plus teams, priorities, awards and raids; never roster, members or requests', () => {
    const extra = grantedTo('raidLeader', WRITES).filter((entry) => !grantedTo('member', WRITES).includes(entry))
    const collections = new Set(extra.map((entry) => entry.split('.')[0]))
    assert.deepEqual([...collections].sort(), ['awards', 'lootPriorities', 'raids', 'teamAssignments'])
  })
})

// match /{document=**}
// Anything the named blocks do not cover is closed to everyone, and a guild's rules never reach into
// another guild.
describe('outside the named collections', () => {
  test('a Guild Leader cannot read or write documents outside guilds/{guildId}', async () => {
    const db = dbFor('guildLeader')
    await expectDenied(setDoc(doc(db, 'users/uid-guild-leader'), { note: 'x' }), 'writing users/{uid}')
    await expectDenied(getDoc(doc(db, 'users/uid-guild-leader')), 'reading users/{uid}')
  })

  test('a Guild Leader cannot read or write a collection the rules do not name', async () => {
    const db = dbFor('guildLeader')
    await expectDenied(getDoc(guildDoc(db, 'secrets/one')), 'reading an unnamed subcollection')
    await expectDenied(setDoc(guildDoc(db, 'secrets/one'), { note: 'x' }), 'writing an unnamed subcollection')
  })

  test('the leader of one guild has no access to another guild', async () => {
    const db = dbFor('guildLeader') // leads guild-test only
    await expectDenied(getDocs(collection(db, `guilds/${OTHER_GUILD_ID}/roster`)), 'listing the other roster')
    await expectDenied(setDoc(doc(db, `guilds/${OTHER_GUILD_ID}/roster/player-9`), rosterDoc(9)), 'adding to the other roster')
    await expectDenied(getDoc(doc(db, `guilds/${OTHER_GUILD_ID}/members/${UID.otherGuildLeader}`)), "reading the other guild's leader doc")
  })

  test("and the other guild's leader works inside their own guild (control)", async () => {
    const db = dbFor('otherGuildLeader')
    await expectAllowed(getDocs(collection(db, `guilds/${OTHER_GUILD_ID}/roster`)), 'listing their own roster')
  })
})
