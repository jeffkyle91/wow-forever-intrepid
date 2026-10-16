// Responses are read by members, but only authenticated server callables may write them.
import { beforeEach, describe, test } from 'node:test'
import { deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { ANY_ROLE, OTHER_GUILD_ID, PLAYER_1, UID, uidOf, type Persona } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()
const payload = () => ({ characterId: PLAYER_1, status: 'accept', updatedAt: serverTimestamp() })
const ref = (who: Persona, uid = UID.member) => guildDoc(dbFor(who), `raids/raid-1/signups/${uid}`)
beforeEach(() => asAdmin((db) => setDoc(guildDoc(db, `raids/raid-1/signups/${UID.member}`), payload())))

describe('server-managed raid responses', () => {
  for (const who of ANY_ROLE) {
    test(`${who} can read and list, but cannot create, update or delete responses directly`, async () => {
      await expectAllowed(getDoc(ref(who)))
      await expectAllowed(getDocs(guildCollection(dbFor(who), 'raids/raid-1/signups')))
      await expectDenied(setDoc(ref(who, uidOf(who)), payload()))
      await expectDenied(setDoc(ref(who), { ...payload(), status: 'absent' }))
      await expectDenied(deleteDoc(ref(who)))
    })
    test(`${who} cannot forge the server transaction lock`, async () => {
      await expectDenied(setDoc(guildDoc(dbFor(who), `availabilityLocks/${uidOf(who)}`), { updatedAt: serverTimestamp() }))
      await expectDenied(getDoc(guildDoc(dbFor(who), `availabilityLocks/${uidOf(who)}`)))
    })
  }
  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`${who} cannot read or write responses`, async () => {
      await expectDenied(getDoc(ref(who)))
      await expectDenied(getDocs(guildCollection(dbFor(who), 'raids/raid-1/signups')))
      await expectDenied(setDoc(ref(who), payload()))
    })
  }
  test('another guild path is refused', async () => {
    const other = doc(dbFor('member'), 'guilds', OTHER_GUILD_ID, 'raids', 'raid-1', 'signups', UID.member)
    await expectDenied(getDoc(other))
    await expectDenied(setDoc(other, payload()))
  })
})
