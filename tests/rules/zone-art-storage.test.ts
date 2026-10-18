// The zone artwork files in Cloud Storage (storage.rules): guilds/<guildId>/zone-art/<imageId>/full-<rev>.<jpg|png|webp> and thumb-<rev>.jpg. Every member of the guild may read
// them, only a Guild Leader of that guild may add or delete one, a file is never overwritten, and a file has to have the right name, type and size. Who is who is read from the
// members documents in Firestore, as in the Firestore rules.
import { describe, test } from 'node:test'
import { ANY_ROLE, GUILD_ID, LABEL, LEADER_ONLY, OTHER_GUILD_ID, SIGNED_IN, type Persona } from './support/fixtures.ts'
import { bucketFor, bucketForUid, existsAsAdmin, expectStorageAllowed, expectStorageDenied, putAsAdmin, seedMemberRole, setUpStorageEmulator, upload } from './support/storage.ts'
import assert from 'node:assert/strict'

setUpStorageEmulator()

const IMAGE = 'abc123xyz'
const path = (file: string, imageId = IMAGE, guild = GUILD_ID) => `guilds/${guild}/zone-art/${imageId}/${file}`
const FULL = path('full-1.jpg')
const THUMB = path('thumb-1.jpg')
const KIB = 1024
const MIB = 1024 * KIB
const nonWriters = (['anonymous', ...SIGNED_IN] as Persona[]).filter((who) => !LEADER_ONLY.includes(who))
const nonReaders = ['anonymous', 'stranger', 'otherGuildLeader'] as const

describe('reading zone artwork', () => {
  for (const who of ANY_ROLE) {
    test(`a ${LABEL[who]} can read a picture and its small copy`, async () => {
      await putAsAdmin(FULL)
      await putAsAdmin(THUMB)
      await expectStorageAllowed(bucketFor(who).ref(FULL).getMetadata(), 'the picture')
      await expectStorageAllowed(bucketFor(who).ref(THUMB).getDownloadURL(), 'the small copy')
    })
  }
  for (const who of nonReaders) {
    test(`a ${LABEL[who]} cannot read them`, async () => {
      await putAsAdmin(FULL)
      await expectStorageDenied(bucketFor(who).ref(FULL).getMetadata())
      await expectStorageDenied(bucketFor(who).ref(FULL).getDownloadURL())
    })
  }
  test('a member who was removed cannot read them, and neither can a signed-in person with no members document', async () => {
    await putAsAdmin(FULL)
    await seedMemberRole('uid-removed-member', 'Removed')
    await expectStorageDenied(bucketForUid('uid-removed-member').ref(FULL).getMetadata(), 'a Removed member')
    await expectStorageDenied(bucketForUid('uid-no-members-document').ref(FULL).getMetadata(), 'no members document')
  })
  test('the leader of one guild cannot read the artwork of another', async () => {
    await putAsAdmin(path('full-1.jpg', IMAGE, OTHER_GUILD_ID))
    await expectStorageDenied(bucketFor('guildLeader').ref(path('full-1.jpg', IMAGE, OTHER_GUILD_ID)).getMetadata())
    await expectStorageAllowed(bucketFor('otherGuildLeader').ref(path('full-1.jpg', IMAGE, OTHER_GUILD_ID)).getMetadata())
  })
})

describe('listing zone artwork', () => {
  const folder = `guilds/${GUILD_ID}/zone-art/${IMAGE}`
  for (const who of ANY_ROLE) {
    test(`a ${LABEL[who]} can list a picture's folder`, async () => {
      await putAsAdmin(FULL)
      await putAsAdmin(THUMB)
      const listing = await bucketFor(who).ref(folder).listAll()
      assert.deepEqual(listing.items.map((item) => item.name).sort(), ['full-1.jpg', 'thumb-1.jpg'])
    })
  }
  for (const who of nonReaders) {
    test(`a ${LABEL[who]} cannot list it`, async () => {
      await putAsAdmin(FULL)
      await expectStorageDenied(bucketFor(who).ref(folder).listAll())
    })
  }
  test('a Removed member and a signed-in person with no members document cannot list it', async () => {
    await putAsAdmin(FULL)
    await seedMemberRole('uid-removed-lister', 'Removed')
    await expectStorageDenied(bucketForUid('uid-removed-lister').ref(folder).listAll(), 'a Removed member')
    await expectStorageDenied(bucketForUid('uid-no-members-document').ref(folder).listAll(), 'no members document')
  })
  test('the leader of another guild cannot list this guild\'s folder, and this guild\'s leader cannot list the other\'s', async () => {
    await putAsAdmin(FULL)
    await putAsAdmin(path('full-1.jpg', IMAGE, OTHER_GUILD_ID))
    await expectStorageDenied(bucketFor('otherGuildLeader').ref(folder).listAll())
    await expectStorageDenied(bucketFor('guildLeader').ref(`guilds/${OTHER_GUILD_ID}/zone-art/${IMAGE}`).listAll())
  })
  test('the guild\'s folder and the top of the bucket cannot be listed, by anyone', async () => {
    await putAsAdmin(FULL)
    for (const who of ['member', 'raidLeader', 'guildLeader'] as const) {
      await expectStorageDenied(bucketFor(who).ref(`guilds/${GUILD_ID}`).listAll(), `${who}: the guild`)
      await expectStorageDenied(bucketFor(who).ref('guilds').listAll(), `${who}: every guild`)
    }
  })
  test('being allowed to list does not let anyone read or write below the folder', async () => {
    await putAsAdmin(`${folder}/more/full-1.jpg`)
    await expectStorageDenied(bucketFor('guildLeader').ref(`${folder}/more/full-1.jpg`).getMetadata(), 'reading a deeper file')
    await expectStorageDenied(upload(bucketFor('guildLeader'), `${folder}/more/full-2.jpg`, 10 * KIB, 'image/jpeg'), 'writing a deeper file')
    await expectStorageDenied(bucketFor('guildLeader').ref(`${folder}/more/full-1.jpg`).delete(), 'deleting a deeper file')
  })
})

describe('adding zone artwork', () => {
  for (const who of LEADER_ONLY) {
    test(`a ${LABEL[who]} can add a picture of each type and a small copy`, async () => {
      await expectStorageAllowed(upload(bucketFor(who), path('full-1.jpg'), 150 * KIB, 'image/jpeg'), 'a jpg')
      await expectStorageAllowed(upload(bucketFor(who), path('full-2.png'), 150 * KIB, 'image/png'), 'a png')
      await expectStorageAllowed(upload(bucketFor(who), path('full-3.webp'), 150 * KIB, 'image/webp'), 'a webp')
      await expectStorageAllowed(upload(bucketFor(who), path('thumb-1.jpg'), 20 * KIB, 'image/jpeg'), 'a small copy')
      assert.ok(await existsAsAdmin(path('full-2.png')))
    })
  }
  for (const who of nonWriters) {
    test(`a ${LABEL[who]} cannot add a picture or a small copy`, async () => {
      await expectStorageDenied(upload(bucketFor(who), FULL, 10 * KIB, 'image/jpeg'), 'a picture')
      await expectStorageDenied(upload(bucketFor(who), THUMB, 10 * KIB, 'image/jpeg'), 'a small copy')
      assert.equal(await existsAsAdmin(FULL), false)
    })
  }
  test('the leader of another guild cannot add to this guild, and this guild\'s leader cannot add to the other', async () => {
    await expectStorageDenied(upload(bucketFor('otherGuildLeader'), FULL, 10 * KIB, 'image/jpeg'))
    await expectStorageDenied(upload(bucketFor('guildLeader'), path('full-1.jpg', IMAGE, OTHER_GUILD_ID), 10 * KIB, 'image/jpeg'))
  })
  test('a Guild Leader who was removed cannot add or delete, and a signed-in person with no members document cannot add', async () => {
    await putAsAdmin(path('full-9.jpg'))
    await seedMemberRole('uid-removed-leader', 'Removed')
    await expectStorageDenied(upload(bucketForUid('uid-removed-leader'), FULL, 10 * KIB, 'image/jpeg'), 'adding')
    await expectStorageDenied(bucketForUid('uid-removed-leader').ref(path('full-9.jpg')).delete(), 'deleting')
    await expectStorageDenied(upload(bucketForUid('uid-never-a-member'), FULL, 10 * KIB, 'image/jpeg'), 'no members document')
  })
})

describe('what a file has to look like', () => {
  const leader = () => bucketFor('guildLeader')

  test('the name is full-<number>.jpg|png|webp or thumb-<number>.jpg, nothing else', async () => {
    for (const file of ['full.jpg', 'full-.jpg', 'full-x.jpg', 'full-1.gif', 'full-1.svg', 'full-1.jpeg', 'full-1.jpg.exe', 'FULL-1.jpg', 'original.jpg', 'thumb-1.png', 'thumb-1.webp', 'thumb-.jpg', 'thumb.jpg', 'x.jpg', '.jpg'])
      await expectStorageDenied(upload(leader(), path(file), 10 * KIB, file.endsWith('.png') ? 'image/png' : 'image/jpeg'), file)
  })

  test('a name with another extension is refused whatever type it claims', async () => {
    for (const [file, type] of [['full-1.gif', 'image/gif'], ['full-1.gif', 'image/webp'], ['full-1.gif', 'image/png'], ['full-1.gif', 'image/jpeg'], ['full-1.jpeg', 'image/jpeg'], ['full-1.svg', 'image/svg+xml'], ['full-1.bmp', 'image/bmp'], ['full-1.avif', 'image/avif'], ['thumb-1.gif', 'image/jpeg']])
      await expectStorageDenied(upload(leader(), path(file), 10 * KIB, type), `${file} as ${type}`)
  })

  test('the type has to be a picture and has to match the name', async () => {
    await expectStorageDenied(upload(leader(), path('full-1.jpg'), 10 * KIB, 'image/png'), 'a jpg named file that says png')
    await expectStorageDenied(upload(leader(), path('full-1.png'), 10 * KIB, 'image/jpeg'), 'a png named file that says jpeg')
    await expectStorageDenied(upload(leader(), path('full-1.webp'), 10 * KIB, 'image/jpeg'), 'a webp named file that says jpeg')
    await expectStorageDenied(upload(leader(), path('full-1.jpg'), 10 * KIB, 'image/svg+xml'), 'an svg (it can carry a script)')
    await expectStorageDenied(upload(leader(), path('full-1.jpg'), 10 * KIB, 'text/html'), 'a web page')
    await expectStorageDenied(upload(leader(), path('full-1.jpg'), 10 * KIB, 'application/octet-stream'), 'unknown content')
    await expectStorageDenied(upload(leader(), path('thumb-1.jpg'), 10 * KIB, 'image/png'), 'a small copy that says png')
  })

  test('a picture may be up to 5 MiB, a small copy up to 300 KiB', async () => {
    await expectStorageAllowed(upload(leader(), path('full-1.jpg'), 5 * MIB, 'image/jpeg'), 'exactly 5 MiB')
    await expectStorageDenied(upload(leader(), path('full-2.jpg'), 5 * MIB + 1, 'image/jpeg'), 'one byte over 5 MiB')
    await expectStorageAllowed(upload(leader(), path('thumb-1.jpg'), 300 * KIB, 'image/jpeg'), 'exactly 300 KiB')
    await expectStorageDenied(upload(leader(), path('thumb-2.jpg'), 300 * KIB + 1, 'image/jpeg'), 'one byte over 300 KiB')
  })

  test('the picture id is 6 to 40 lowercase letters and digits', async () => {
    await expectStorageAllowed(upload(leader(), path('full-1.jpg', 'abc123'), 10 * KIB, 'image/jpeg'), '6 characters')
    await expectStorageAllowed(upload(leader(), path('full-1.jpg', 'a'.repeat(40)), 10 * KIB, 'image/jpeg'), '40 characters')
    for (const imageId of ['abc12', 'a'.repeat(41), 'ABC123XYZ', 'abc-123-xyz', 'abc_123_xyz', 'abc 123 xyz', '..', 'abc123.xyz'])
      await expectStorageDenied(upload(leader(), path('full-1.jpg', imageId), 10 * KIB, 'image/jpeg'), imageId)
  })

  test('files only live directly inside a picture\'s folder of the zone-art folder', async () => {
    await expectStorageDenied(upload(leader(), `guilds/${GUILD_ID}/zone-art/full-1.jpg`, 10 * KIB, 'image/jpeg'), 'no picture folder')
    await expectStorageDenied(upload(leader(), `guilds/${GUILD_ID}/zone-art/${IMAGE}/more/full-1.jpg`, 10 * KIB, 'image/jpeg'), 'one folder too deep')
    await expectStorageDenied(upload(leader(), `guilds/${GUILD_ID}/other/${IMAGE}/full-1.jpg`, 10 * KIB, 'image/jpeg'), 'another folder of the guild')
    await expectStorageDenied(upload(leader(), `zone-art/${IMAGE}/full-1.jpg`, 10 * KIB, 'image/jpeg'), 'no guild')
    await expectStorageDenied(upload(leader(), 'full-1.jpg', 10 * KIB, 'image/jpeg'), 'the top of the bucket')
  })

  test('nothing outside the zone-art folder can be read either, by anyone', async () => {
    await putAsAdmin(`guilds/${GUILD_ID}/other/x.jpg`)
    for (const who of ['member', 'raidLeader', 'guildLeader'] as const) await expectStorageDenied(bucketFor(who).ref(`guilds/${GUILD_ID}/other/x.jpg`).getMetadata(), who)
  })
})

describe('changing and removing zone artwork', () => {
  test('a file that exists is never overwritten, not even by a Guild Leader (a replaced picture is a new rev)', async () => {
    await putAsAdmin(FULL)
    await expectStorageDenied(upload(bucketFor('guildLeader'), FULL, 20 * KIB, 'image/jpeg'), 'the same name again')
    await expectStorageAllowed(upload(bucketFor('guildLeader'), path('full-2.jpg'), 20 * KIB, 'image/jpeg'), 'the next rev')
  })
  test('a metadata change is refused too', async () => {
    await putAsAdmin(FULL)
    await expectStorageDenied(bucketFor('guildLeader').ref(FULL).updateMetadata({ cacheControl: 'no-store' }))
  })
  for (const who of LEADER_ONLY) {
    test(`a ${LABEL[who]} can delete a picture`, async () => {
      await putAsAdmin(FULL)
      await expectStorageAllowed(bucketFor(who).ref(FULL).delete())
      assert.equal(await existsAsAdmin(FULL), false)
    })
  }
  for (const who of nonWriters) {
    test(`a ${LABEL[who]} cannot delete one`, async () => {
      await putAsAdmin(FULL)
      await expectStorageDenied(bucketFor(who).ref(FULL).delete())
      assert.ok(await existsAsAdmin(FULL))
    })
  }
  test('the leader of another guild cannot delete one', async () => {
    await putAsAdmin(FULL)
    await expectStorageDenied(bucketFor('otherGuildLeader').ref(FULL).delete())
    assert.ok(await existsAsAdmin(FULL))
  })
})
