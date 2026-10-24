import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encounterLabel } from '../../src/shared/game/encounter.ts'

// Invented names.
describe('encounterLabel', () => {
  it('drops the separator of a dungeon recorded with no boss', () => {
    assert.equal(encounterLabel('Test Hall ·'), 'Test Hall')
    assert.equal(encounterLabel('Test Hall · '), 'Test Hall')
    assert.equal(encounterLabel('Test Hall·'), 'Test Hall')
  })
  it('leaves a dungeon and boss, a boss alone and a later dot as they are', () => {
    assert.equal(encounterLabel('Test Hall · Hall Warden'), 'Test Hall · Hall Warden')
    assert.equal(encounterLabel('Hall Warden'), 'Hall Warden')
    assert.equal(encounterLabel('Test Hall · Warden · Second'), 'Test Hall · Warden · Second')
  })
  it('is empty for nothing, or for a separator alone', () => {
    assert.equal(encounterLabel(''), '')
    assert.equal(encounterLabel('  '), '')
    assert.equal(encounterLabel('·'), '')
  })
})
