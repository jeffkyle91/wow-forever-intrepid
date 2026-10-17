import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { slotLabels } from '../../src/shared/game/itemTooltip.ts'
import { slotCategory, slotChoices } from '../../src/features/loot/slots.ts'

describe('slotCategory', () => {
  it('puts every label the tooltip can give in one of the filter choices', () => {
    for (const label of slotLabels) assert.ok((slotChoices as readonly string[]).includes(slotCategory(label, 'Anything')), label)
  })
  it('maps the labels the way the filter words them', () => {
    const expected: Record<string, string> = {
      Head: 'Head', Neck: 'Neck', Shoulder: 'Shoulder', Back: 'Back', Chest: 'Chest', Robe: 'Chest', Wrist: 'Wrist', Hands: 'Hands', Waist: 'Waist', Legs: 'Legs',
      Feet: 'Feet', Finger: 'Finger', Trinket: 'Trinket', 'One-Hand': '1H Weapon', 'Main Hand': '1H Weapon', 'Two-Hand': '2H Weapon', 'Off Hand': 'Off-Hand',
      'Held In Off-hand': 'Off-Hand', Ranged: 'Ranged', Thrown: 'Ranged', Relic: 'Relic',
    }
    for (const [label, choice] of Object.entries(expected)) assert.equal(slotCategory(label, 'Anything'), choice, label)
  })
  it('ignores case and spaces in the label', () => assert.equal(slotCategory('  two-HAND ', 'Axe'), '2H Weapon'))
  it('calls an item with no slot a Tier Token when its name says token, and Other otherwise', () => {
    assert.equal(slotCategory(undefined, 'Vanquisher Token'), 'Tier Token')
    assert.equal(slotCategory(undefined, 'token of the ages'), 'Tier Token')
    assert.equal(slotCategory(undefined, 'Snakeskin Bag'), 'Other')
    assert.equal(slotCategory(undefined, 'Tokenizer Rod'), 'Other')
    assert.equal(slotCategory(undefined, ''), 'Other')
  })
  it('calls a label it does not know Other', () => assert.equal(slotCategory('Tabard', 'Guild Tabard'), 'Other'))
  it('offers Other and Tier Token among the choices, and each choice once', () => {
    assert.ok(slotChoices.includes('Other') && slotChoices.includes('Tier Token'))
    assert.equal(new Set(slotChoices).size, slotChoices.length)
  })
})
