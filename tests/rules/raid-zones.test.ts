// Raid zone catalog records are maintained by Guild Leaders and read by guild members.
import { describe, test } from 'node:test'
import { deleteDoc, getDoc, setDoc } from 'firebase/firestore'
import { ANY_ROLE, LABEL, LEADER_ONLY, SIGNED_IN, type Persona } from './support/fixtures.ts'
import { dbFor, expectAllowed, expectDenied, guildDoc, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

const validZone = { name: 'Barrow Deeps', size: 10 }
const zonePath = 'raidZones/barrow-deeps'
const save = (who: Persona, data: Record<string, unknown>) => setDoc(guildDoc(dbFor(who), zonePath), data)
const writers = LEADER_ONLY
const nonWriters = (['anonymous', ...SIGNED_IN] as Persona[]).filter((who) => !writers.includes(who))

describe('reading the raid-zone catalog', () => {
  for (const who of ANY_ROLE) {
    test(`a ${LABEL[who]} can read a zone`, async () => {
      await expectAllowed(setDoc(guildDoc(dbFor('guildLeader'), zonePath), validZone))
      await expectAllowed(getDoc(guildDoc(dbFor(who), zonePath)))
    })
  }

  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`a ${LABEL[who]} cannot read a zone`, async () => {
      await expectDenied(getDoc(guildDoc(dbFor(who), zonePath)))
    })
  }
})

describe('writing the raid-zone catalog', () => {
  for (const who of writers) {
    test(`a ${LABEL[who]} can create, update and delete a zone`, async () => {
      await expectAllowed(save(who, validZone), 'creating')
      await expectAllowed(save(who, { name: 'Barrow Deeps Updated', size: 20 }), 'updating')
      await expectAllowed(deleteDoc(guildDoc(dbFor(who), zonePath)), 'deleting')
    })
  }

  for (const who of nonWriters) {
    test(`a ${LABEL[who]} cannot create a zone`, async () => {
      await expectDenied(save(who, validZone))
    })
  }

  const invalid = [
    ['a blank name', { name: '   ', size: 10 }],
    ['a name longer than 80 characters', { name: 'x'.repeat(81), size: 10 }],
    ['an unsupported player size', { name: 'Zone', size: 25 }],
    ['a numeric player size stored as text', { name: 'Zone', size: '10' }],
    ['an extra field', { name: 'Zone', size: 10, enabled: true }],
    ['a missing size', { name: 'Zone' }],
  ] as const

  for (const [label, data] of invalid) {
    test(`a Guild Leader cannot save ${label}`, async () => {
      await expectDenied(save('guildLeader', data))
    })
  }
})
