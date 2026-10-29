// The picture and color of a zone of a scheduled raid (shared/raids/raidZoneArt.ts): which key a raid's zone id maps to, and how that finds its picture and color.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ZoneArt, ZoneImage } from '../../src/shared/game/zoneArt.ts'
import { raidZoneColor, raidZoneImage, raidZoneKey } from '../../src/shared/raids/raidZoneArt.ts'

const image = (id: string, name: string): ZoneImage => ({
  id, name, rev: 1, bytes: 1000, width: 1920, height: 1080,
  full: `zone-art/${id}/1.jpg`, fullUrl: `https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/${id}-full?alt=media&token=t`,
  thumb: `zone-art/${id}/1-thumb.jpg`, thumbUrl: `https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/${id}-thumb?alt=media&token=t`,
})
const art: ZoneArt = {
  images: [image('keep01', 'Invented Keep'), image('deeps02', 'Invented Deeps')],
  art: { '719': 'keep01', 'r-zone-b': 'deeps02', '12': 'gone99' },
}

describe('which key a raid zone is known by', () => {
  test('z and a zone number is that zone number, without leading zeros', () => {
    assert.equal(raidZoneKey('z719'), '719')
    assert.equal(raidZoneKey('z0719'), '719')
    assert.equal(raidZoneKey('z0'), '0')
    assert.equal(raidZoneKey('z000000012'), '12')
  })

  test('any other id is the key of an older raid zone, when that is a valid key', () => {
    assert.equal(raidZoneKey('zone-b'), 'r-zone-b')
    assert.equal(raidZoneKey('3f2a9c10-77b1-4c1e-9d55-0a1b2c3d4e5f'), 'r-3f2a9c10-77b1-4c1e-9d55-0a1b2c3d4e5f')
    assert.equal(raidZoneKey('z'), 'r-z')
    assert.equal(raidZoneKey('z12abc'), 'r-z12abc')
    assert.equal(raidZoneKey('z1234567890'), 'r-z1234567890', 'ten digits is too many for a zone number, so it is an older id')
  })

  test('an id that cannot be a key has none, and nothing throws', () => {
    for (const id of ['', 'has space', 'line\nbreak', 'a/b', 'x'.repeat(41), 'zone b', 'é', '<script>']) assert.equal(raidZoneKey(id), undefined, JSON.stringify(id))
    assert.equal(raidZoneKey('x'.repeat(40)), `r-${'x'.repeat(40)}`)
  })
})

describe('the picture of a raid zone', () => {
  test('is found from the id alone, so a renamed zone keeps its picture', () => {
    assert.equal(raidZoneImage(art, 'z719')?.id, 'keep01')
    assert.equal(raidZoneImage(art, 'z0719')?.id, 'keep01')
    assert.equal(raidZoneImage(art, 'zone-b')?.id, 'deeps02')
  })

  test('is none for a zone with no picture, an id with no key, or a picture that was removed', () => {
    assert.equal(raidZoneImage(art, 'z720'), undefined)
    assert.equal(raidZoneImage(art, 'zone-c'), undefined)
    assert.equal(raidZoneImage(art, 'has space'), undefined)
    assert.equal(raidZoneImage(art, 'z12'), undefined, 'the art entry points at a picture that no longer exists')
    assert.equal(raidZoneImage({ images: [], art: {} }, 'z719'), undefined)
  })
})

describe('the color of a raid zone', () => {
  test('is the guild\'s choice when there is one, else the same automatic color every time', () => {
    assert.equal(raidZoneColor('z719', { '719': '#112233' }), '#112233')
    assert.equal(raidZoneColor('z0719', { '719': '#112233' }), '#112233')
    assert.equal(raidZoneColor('z719'), raidZoneColor('z719', {}))
    assert.match(raidZoneColor('zone-b'), /^#[0-9a-f]{6}$/)
  })

  test('is the neutral slate for an id with no key', () => {
    assert.equal(raidZoneColor('has space'), '#637f8e')
    assert.equal(raidZoneColor(''), '#637f8e')
  })
})
