import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { popoverPosition } from '../../src/shared/ui/popoverPosition.ts'

describe('popoverPosition', () => {
  const viewport = { left: 0, top: 0, width: 390, height: 700 }
  const panel = { width: 300, height: 200 }

  it('opens below when there is space', () => {
    assert.deepEqual(popoverPosition({ left: 30, top: 100, bottom: 144 }, panel, viewport), { left: 30, top: 150 })
  })

  it('opens above near the bottom and clamps the right edge', () => {
    assert.deepEqual(popoverPosition({ left: 340, top: 600, bottom: 644 }, panel, viewport), { left: 78, top: 394 })
  })

  it('keeps a viewport-width panel inside a narrow screen', () => {
    assert.deepEqual(popoverPosition({ left: 600, top: 300, bottom: 344 }, { width: 288, height: 200 }, { ...viewport, width: 312 }), { left: 12, top: 350 })
  })

  it('clamps vertically when neither side has enough room', () => {
    assert.deepEqual(popoverPosition({ left: -50, top: 100, bottom: 144 }, { width: 276, height: 276 }, { ...viewport, width: 300, height: 300 }), { left: 12, top: 12 })
  })

  it('accounts for a visual viewport offset when zoomed', () => {
    assert.deepEqual(popoverPosition({ left: 800, top: 600, bottom: 644 }, panel, { left: 100, top: 200, width: 390, height: 700 }), { left: 178, top: 650 })
  })
})
