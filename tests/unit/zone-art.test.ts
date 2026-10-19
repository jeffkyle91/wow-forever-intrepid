// The artwork of the zones (shared/game/zoneArt.ts): reading the settings document safely, finding a zone's picture, naming a picture from its file, making ids.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, THUMB_WIDTH, fullPath, imageNameFromFile, imageOfZone, isImageId, isImageName, isSafeImageUrl, matchImagesToZones, newImageId, readZoneArt, thumbPath, zonesUsing, type ZoneArt } from '../../src/shared/game/zoneArt.ts'

const GUILD = 'guild-test'
const BUCKET = 'demo.appspot.com'
const SOURCE = { guildId: GUILD, bucket: BUCKET }
const TOKEN = 'alt=media&token=0a1b2c3d-1111-2222-3333-444455556666'
const urlOf = (path: string, bucket = BUCKET) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?${TOKEN}`
const URL_FULL = urlOf(fullPath(GUILD, 'abc123xyz', 1, 'jpg'))
const read = (images: unknown, art: unknown) => readZoneArt(images, art, SOURCE)
const entry = (overrides: Record<string, unknown> = {}, id = 'abc123xyz', rev = 1) => ({
  name: 'Molten Core', rev, bytes: 157_732, width: 1920, height: 1080,
  full: fullPath(GUILD, id, rev, 'jpg'), fullUrl: urlOf(fullPath(GUILD, id, rev, 'jpg')), thumb: thumbPath(GUILD, id, rev), thumbUrl: urlOf(thumbPath(GUILD, id, rev)), ...overrides,
})

describe('reading the artwork document', () => {
  test('a well formed picture is kept, with the picture of each zone', () => {
    const art = read({ abc123xyz: entry() }, { 719: 'abc123xyz', 'r-old_1': 'abc123xyz' })
    assert.equal(art.images.length, 1)
    assert.deepEqual(art.images[0], { id: 'abc123xyz', ...entry() })
    assert.deepEqual(art.art, { 719: 'abc123xyz', 'r-old_1': 'abc123xyz' })
  })

  test('nothing, or not maps, is no artwork', () => {
    for (const bad of [undefined, null, 5, 'x', [], true]) assert.deepEqual(read(bad, bad), { images: [], art: {} }, JSON.stringify(bad))
  })

  test('pictures are listed by name, and by id when the names are alike', () => {
    const art = read({ ccc333: entry({ name: 'zul' }, 'ccc333'), aaa111: entry({ name: 'Onyxia' }, 'aaa111'), bbb222: entry({ name: 'Onyxia' }, 'bbb222') }, {})
    assert.deepEqual(art.images.map((image) => image.id), ['aaa111', 'bbb222', 'ccc333'])
  })

  test('a picture with any part wrong is dropped, the others stay', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['no name', { name: undefined }], ['a blank name', { name: '   ' }], ['a name that is too long', { name: 'x'.repeat(61) }], ['a name that is not text', { name: 5 }],
      ['rev 0', { rev: 0 }], ['a fractional rev', { rev: 1.5 }], ['a rev that is text', { rev: '1' }],
      ['no bytes', { bytes: 0 }], ['bytes over the limit', { bytes: 5 * 1024 * 1024 + 1 }], ['no width', { width: 0 }], ['no height', { height: undefined }],
      ['a full path of another picture', { full: fullPath(GUILD, 'zzz999', 1, 'jpg') }], ['a full path of another rev', { full: fullPath(GUILD, 'abc123xyz', 2, 'jpg') }],
      ['a full path with another extension', { full: fullPath(GUILD, 'abc123xyz', 1, 'gif') }], ['a full path outside zone-art', { full: 'guilds/guild-test/other/abc123xyz/full-1.jpg' }],
      ['a full path that climbs out', { full: 'guilds/guild-test/zone-art/abc123xyz/../../x/full-1.jpg' }], ['a thumb path of another picture', { thumb: thumbPath(GUILD, 'zzz999', 1) }],
      ['a thumb that is a png', { thumb: 'guilds/guild-test/zone-art/abc123xyz/thumb-1.png' }], ['no thumb', { thumb: undefined }],
      ['an address on another host', { fullUrl: 'https://example.com/v0/b/x/o/y?alt=media' }], ['a javascript address', { thumbUrl: 'javascript:alert(1)' }],
      ['an address with a quote', { fullUrl: `${URL_FULL}"` }], ['an address with a parenthesis', { thumbUrl: `${urlOf(thumbPath(GUILD, 'abc123xyz', 1))})` }], ['an address with a space', { fullUrl: `${URL_FULL} x` }],
      ['an http address on a real host', { fullUrl: URL_FULL.replace('https://', 'http://') }],
    ]
    for (const [what, change] of bad) assert.deepEqual(read({ abc123xyz: entry(change), good123: entry({}, 'good123') }, {}).images.map((image) => image.id), ['good123'], what)
    assert.deepEqual(read({ abc123xyz: 5, good123: entry({}, 'good123'), def456: null, ghi789: [] }, {}).images.map((image) => image.id), ['good123'], 'entries that are not objects')
  })

  test('a picture in another guild\'s folder, another bucket, or at another address is dropped', () => {
    const other = (change: Record<string, unknown>) => read({ abc123xyz: entry(change) }, {}).images.length
    assert.equal(other({}), 1)
    assert.equal(other({ full: fullPath('guild-other', 'abc123xyz', 1, 'jpg'), fullUrl: urlOf(fullPath('guild-other', 'abc123xyz', 1, 'jpg')) }), 0, 'another guild\'s folder')
    assert.equal(other({ thumb: thumbPath('guild-other', 'abc123xyz', 1), thumbUrl: urlOf(thumbPath('guild-other', 'abc123xyz', 1)) }), 0, 'another guild\'s small copy')
    assert.equal(other({ fullUrl: urlOf(fullPath(GUILD, 'abc123xyz', 1, 'jpg'), 'attacker-bucket') }), 0, 'an address in another bucket')
    assert.equal(other({ thumbUrl: urlOf(thumbPath(GUILD, 'abc123xyz', 1), 'attacker-bucket') }), 0, 'a small copy address in another bucket')
    assert.equal(other({ fullUrl: urlOf('x.jpg') }), 0, 'an address of some other object')
    assert.equal(other({ fullUrl: urlOf(thumbPath(GUILD, 'abc123xyz', 1)) }), 0, 'the picture\'s address pointing at its small copy')
    assert.equal(other({ thumbUrl: urlOf(fullPath(GUILD, 'abc123xyz', 1, 'jpg')) }), 0, 'the small copy\'s address pointing at the picture')
    assert.equal(other({ fullUrl: urlOf(fullPath(GUILD, 'abc123xyz', 2, 'jpg')) }), 0, 'an address of another rev')
    assert.equal(readZoneArt({ abc123xyz: entry() }, {}, { guildId: GUILD, bucket: 'another-bucket' }).images.length, 0, 'this app is in another bucket')
    assert.equal(readZoneArt({ abc123xyz: entry() }, {}, { guildId: 'guild-other', bucket: BUCKET }).images.length, 0, 'this app is another guild')
  })

  test('the size of a picture has limits that match the upload', () => {
    const size = (width: number, height: number) => read({ abc123xyz: entry({ width, height }) }, {}).images.length
    assert.equal(size(MAX_IMAGE_SIDE, 1), 1)
    assert.equal(size(MAX_IMAGE_SIDE + 1, 1), 0)
    assert.equal(size(1, MAX_IMAGE_SIDE + 1), 0)
    assert.equal(size(Math.floor(MAX_IMAGE_PIXELS / 8000), 8000), 1)
    assert.equal(size(8000, Math.floor(MAX_IMAGE_PIXELS / 8000) + 1), 0, 'over the pixel limit with both sides within bounds')
  })

  test('an id that is not an id is dropped', () => {
    for (const id of ['abc12', 'ABC123XYZ', 'abc-123', 'a'.repeat(41), '__proto__', 'abc.123']) assert.deepEqual(read({ [id]: entry({}, id) }, {}).images, [], id)
  })

  test('the local emulator\'s address is accepted', () => {
    const emulator = URL_FULL.replace('https://firebasestorage.googleapis.com', 'http://127.0.0.1:19199')
    assert.equal(read({ abc123xyz: entry({ fullUrl: emulator }) }, {}).images.length, 1)
    assert.equal(read({ abc123xyz: entry({ fullUrl: emulator.replace('127.0.0.1', 'localhost') }) }, {}).images.length, 1)
    assert.equal(read({ abc123xyz: entry({ fullUrl: emulator.replace('127.0.0.1', 'evil.example') }) }, {}).images.length, 0)
  })

  test('a zone pick is kept only for a zone key and a picture that exists', () => {
    const art = read({ abc123xyz: entry() }, { 719: 'abc123xyz', 'r-ok': 'abc123xyz', x: 'abc123xyz', '-1': 'abc123xyz', '': 'abc123xyz', 800: 'missing1', 801: 5, 802: null, 803: 'ABC123XYZ' })
    assert.deepEqual(art.art, { 719: 'abc123xyz', 'r-ok': 'abc123xyz' })
  })

  test('a pick of a picture that was dropped for being malformed is dropped with it', () => {
    assert.deepEqual(read({ abc123xyz: entry({ rev: 0 }) }, { 719: 'abc123xyz' }), { images: [], art: {} })
  })
})

describe('finding a zone\'s picture', () => {
  const art: ZoneArt = read({ abc123xyz: entry(), def456uvw: entry({ name: 'Onyxia\'s Lair' }, 'def456uvw') }, { 719: 'abc123xyz', 1581: 'abc123xyz', 21: 'def456uvw' })
  test('by the zone\'s number or key', () => {
    assert.equal(imageOfZone(art, 719)?.name, 'Molten Core')
    assert.equal(imageOfZone(art, '719')?.name, 'Molten Core')
    assert.equal(imageOfZone(art, 21)?.name, 'Onyxia\'s Lair')
  })
  test('a zone with no pick has none', () => {
    assert.equal(imageOfZone(art, 5), undefined)
    assert.equal(imageOfZone(art, 'r-none'), undefined)
    assert.equal(imageOfZone({ images: [], art: {} }, 719), undefined)
  })
  test('the zones that use a picture', () => {
    assert.deepEqual(zonesUsing(art, 'abc123xyz').sort(), ['1581', '719'])
    assert.deepEqual(zonesUsing(art, 'def456uvw'), ['21'])
    assert.deepEqual(zonesUsing(art, 'nobody1'), [])
  })
})

describe('naming a picture from its file', () => {
  const cases: Array<[string, string]> = [
    ['Molten_Core_loading_screen.jpg', 'Molten Core'],
    ['Onyxia\'s_Lair_loading_screen.jpg', 'Onyxia\'s Lair'],
    ['Scholomance_old_loading_screen.jpg', 'Scholomance old'],
    ['Zul\'Gurub_loading_screen.jpg', 'Zul\'Gurub'],
    ['C:\\Users\\someone\\Pictures\\Dire_Maul_loading_screen.JPG', 'Dire Maul'],
    ['/home/x/Naxxramas.webp', 'Naxxramas'],
    ['Temple of Ahn\'Qiraj  loading screen.png', 'Temple of Ahn\'Qiraj'],
    ['karazhan-loading-screen.jpg', 'karazhan'],
    ['Azjol-Nerub_loading_screen.jpg', 'Azjol-Nerub'],
    ['.jpg', 'Picture'],
    ['___.png', 'Picture'],
    ['loading_screen.jpg', 'Picture'],
    ['', 'Picture'],
  ]
  for (const [file, name] of cases) test(`${JSON.stringify(file)} is called ${JSON.stringify(name)}`, () => assert.equal(imageNameFromFile(file), name))
  test('a long name is cut to the longest allowed and still passes the name check', () => {
    const name = imageNameFromFile(`${'A_long_name_'.repeat(20)}.jpg`)
    assert.ok(name.length <= 60)
    assert.ok(isImageName(name))
  })
})

describe('names, ids, addresses and paths', () => {
  test('a name is 1 to 60 characters after trimming', () => {
    assert.equal(isImageName('Molten Core'), true)
    assert.equal(isImageName('x'.repeat(60)), true)
    assert.equal(isImageName('x'.repeat(61)), false)
    assert.equal(isImageName('   '), false)
    assert.equal(isImageName(''), false)
  })
  test('ids are 6 to 40 lowercase letters and digits', () => {
    for (const ok of ['abc123', 'a'.repeat(40), '0123456789abcdefghij']) assert.equal(isImageId(ok), true, ok)
    for (const bad of ['abc12', 'a'.repeat(41), 'ABC123', 'abc-123', 5, null, undefined]) assert.equal(isImageId(bad), false, String(bad))
  })
  test('a new id passes the id check, comes from the random source, and differs between calls', () => {
    const id = newImageId()
    assert.equal(id.length, 20)
    assert.ok(isImageId(id))
    assert.notEqual(id, newImageId())
    assert.equal(newImageId(() => new Array(20).fill(0)), 'a'.repeat(20))
    assert.equal(newImageId(() => new Array(20).fill(35)), '9'.repeat(20))
    assert.equal(newImageId(() => new Array(20).fill(255)), 'd'.repeat(20)) // 255 % 36 = 3
  })
  test('the paths match what storage.rules accepts', () => {
    assert.equal(fullPath('g1', 'abc123', 3, 'webp'), 'guilds/g1/zone-art/abc123/full-3.webp')
    assert.equal(thumbPath('g1', 'abc123', 3), 'guilds/g1/zone-art/abc123/thumb-3.jpg')
    assert.equal(THUMB_WIDTH, 480)
  })
  test('addresses', () => {
    assert.equal(isSafeImageUrl(URL_FULL), true)
    for (const bad of ['', 5, null, 'https://firebasestorage.googleapis.com/v0/b/x/o/y', 'https://firebasestorage.googleapis.com.evil.example/v0/b/x/o/y?alt=media', `${URL_FULL}${'a'.repeat(800)}`]) assert.equal(isSafeImageUrl(bad), false, String(bad))
  })
})

describe('giving the zones the pictures with their names', () => {
  const library = (...pictures: Array<[string, string]>): ZoneArt => read(Object.fromEntries(pictures.map(([id, name]) => [id, entry({ name }, id)])), {})
  const zones = [{ key: '719', name: 'Molten Core' }, { key: '1581', name: 'The Deadmines' }, { key: '21', name: 'Scarlet Monastery' }, { key: 'r-old_1', name: 'Zul\u2019Gurub' }, { key: '5', name: 'Gnomeregan' }]

  test('a zone gets the picture with the same name, ignoring case, apostrophes, "the" and "old"', () => {
    const art = library(['aaa111', 'molten core'], ['bbb222', 'Deadmines'], ['ccc333', 'Scarlet Monastery old'], ['ddd444', "Zul'Gurub"])
    assert.deepEqual(matchImagesToZones(zones, art), { 719: 'aaa111', 1581: 'bbb222', 21: 'ccc333', 'r-old_1': 'ddd444' })
  })
  test('a zone that has a picture is left alone, and so is one without a match', () => {
    const art = read({ aaa111: entry({ name: 'Molten Core' }, 'aaa111'), bbb222: entry({ name: 'Gnomeregan' }, 'bbb222') }, { 719: 'bbb222' })
    assert.deepEqual(matchImagesToZones(zones, art), { 5: 'bbb222' })
    assert.deepEqual(matchImagesToZones(zones, library()), {})
  })
  test('two pictures with the same loose name match no zone, because the pick would be a guess', () => {
    assert.deepEqual(matchImagesToZones([{ key: '21', name: 'Scarlet Monastery' }], library(['aaa111', 'Scarlet Monastery'], ['bbb222', 'Scarlet Monastery old'])), {})
  })
  test('a name that is only "the" or "old" matches nothing, and a key that is not a zone key is skipped', () => {
    assert.deepEqual(matchImagesToZones([{ key: '1', name: 'The' }, { key: 'x', name: 'Molten Core' }], library(['aaa111', 'Old'], ['bbb222', 'Molten Core'])), {})
  })
})
