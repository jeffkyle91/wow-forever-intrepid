import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { confirmHolds, confirmLabel, nothingToSave } from '../../src/features/loot/dropImportView.ts'
import type { ImportCounts } from '../../src/features/loot/dropImport.ts'

// What the drop list import panel (DropImportPanel.tsx) shows and does, as pure functions. Every name and id is invented.

const counts = (patch: Partial<ImportCounts> = {}): ImportCounts => ({ zones: 0, newZones: 0, creatures: 0, newCreatures: 0, items: 0, journalItems: 0, unanswered: 0, ...patch })

describe('the import panel: the confirm step', () => {
  it('names the phase it saves to, with the counts', () => {
    assert.equal(confirmLabel('Phase 4', counts({ zones: 1, creatures: 2, newCreatures: 2, items: 3 })), 'Save to Phase 4: 1 zone, 2 creatures (2 new), 3 items')
  })

  it('has nothing to save when no zone, creature or item is saved', () => {
    assert.equal(nothingToSave(undefined), true)
    assert.equal(nothingToSave(counts({ unanswered: 1 })), true)
    assert.equal(nothingToSave(counts({ zones: 1 })), false)
    assert.equal(nothingToSave(counts({ journalItems: 1 })), false)
  })

  it('closes when the phase or the pasted text changes', () => {
    const open = { phaseNo: 4, text: 'IM1:drops:test' }
    assert.equal(confirmHolds(open, 4, 'IM1:drops:test'), true)
    assert.equal(confirmHolds(open, 3, 'IM1:drops:test'), false)
    assert.equal(confirmHolds(open, 4, 'IM1:drops:other'), false)
    assert.equal(confirmHolds(null, 4, 'IM1:drops:test'), false)
  })
})
