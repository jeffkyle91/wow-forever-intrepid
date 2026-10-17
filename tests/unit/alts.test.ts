import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { altIds } from '../../src/shared/game/alts.ts'

// Every id here is invented: this repository is public.
describe('altIds', () => {
  it('finds a character that links to a main', () => {
    assert.deepEqual([...altIds([{ id: 'a' }, { id: 'b', mainId: 'a' }])], ['b'])
  })

  it('does not count a main, or a character with no link', () => {
    assert.equal(altIds([{ id: 'a' }, { id: 'b' }]).size, 0)
  })

  it('ignores a link to a missing character', () => {
    assert.equal(altIds([{ id: 'a' }, { id: 'b', mainId: 'ghost' }]).size, 0)
  })

  it('ignores a link to itself and a link to another alt', () => {
    assert.equal(altIds([{ id: 'a', mainId: 'a' }]).size, 0)
    assert.deepEqual([...altIds([{ id: 'a' }, { id: 'b', mainId: 'a' }, { id: 'c', mainId: 'b' }])], ['b'])
  })

  it('finds every alt of a main', () => {
    assert.deepEqual([...altIds([{ id: 'a' }, { id: 'b', mainId: 'a' }, { id: 'c', mainId: 'a' }])].sort(), ['b', 'c'])
  })
})
