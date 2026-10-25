// The launch reset (docs/design/launch-reset.md) is done by the maintainer's script with the Admin SDK, which the rules do not apply to. These tests pin what that
// relies on: nobody can do any part of it through the app, so the seal and the record it leaves cannot be forged, undone or repeated from a browser, and an
// erased phase's awards and Log entries cannot be deleted by anyone.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, setDoc, updateDoc } from 'firebase/firestore'
import { LABEL, PERSONAS, type Persona } from './support/fixtures.ts'
import { asAdmin, dbFor, expectDenied, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'

setUpGuildEmulator()

const seal = { phaseNo: 0, phaseName: 'Launch prep', erased: { awards: 1, priorities: 1, auditEntries: 1 }, version: 1 }
const record = { at: new Date(), by: 'launch-reset', byName: 'Launch reset', targetType: 'ledger', targetId: 'launch-reset', rev: 1, action: 'erase', item: 'Launch prep', changed: ['awards'], before: { awards: 1 }, after: {} }

describe('the seal and the record of the launch reset', () => {
  for (const who of PERSONAS) {
    test(`a ${LABEL[who]} cannot write the seal, change it or delete it`, async () => {
      await expectDenied(setDoc(guildDoc(dbFor(who), 'settings/launchReset'), seal), 'writing the seal')
      await asAdmin((db) => setDoc(guildDoc(db, 'settings/launchReset'), seal))
      await expectDenied(setDoc(guildDoc(dbFor(who), 'settings/launchReset'), { ...seal, phaseNo: 1 }), 'overwriting the seal')
      await expectDenied(updateDoc(guildDoc(dbFor(who), 'settings/launchReset'), { phaseNo: 1 }), 'updating the seal')
      await expectDenied(deleteDoc(guildDoc(dbFor(who), 'settings/launchReset')), 'deleting the seal')
      assert.deepEqual(await stored('settings/launchReset'), seal)
    })

    test(`a ${LABEL[who]} cannot write the Log record of it, change it or delete it`, async () => {
      await expectDenied(setDoc(guildDoc(dbFor(who), 'auditLog/ledger_launch-reset_1'), { ...record, by: 'uid-x' }), 'writing the record')
      await asAdmin((db) => setDoc(guildDoc(db, 'auditLog/ledger_launch-reset_1'), record))
      await expectDenied(updateDoc(guildDoc(dbFor(who), 'auditLog/ledger_launch-reset_1'), { item: 'Other' }), 'changing the record')
      await expectDenied(deleteDoc(guildDoc(dbFor(who), 'auditLog/ledger_launch-reset_1')), 'deleting the record')
      assert.equal((await stored('auditLog/ledger_launch-reset_1'))?.item, 'Launch prep')
    })
  }

  test('nobody can delete an award or a Log entry through the app, which is why the reset is not done there', async () => {
    await asAdmin(async (db) => {
      await setDoc(guildDoc(db, 'awards/a1'), { item: 'Invented Sword', recipient: 'Aria', awardedAt: '2026-11-05', phaseNo: 0 })
      await setDoc(guildDoc(db, 'auditLog/award_a1_1'), { targetType: 'award', targetId: 'a1', rev: 1, action: 'create', item: 'Invented Sword', changed: [], before: {}, after: {} })
    })
    for (const who of PERSONAS as readonly Persona[]) {
      await expectDenied(deleteDoc(guildDoc(dbFor(who), 'awards/a1')), `${LABEL[who]} deleting an award`)
      await expectDenied(deleteDoc(guildDoc(dbFor(who), 'auditLog/award_a1_1')), `${LABEL[who]} deleting a Log entry`)
    }
  })
})
