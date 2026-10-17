import { itemSlotLabel } from '../../shared/game/itemTooltip'
import { peekItem, useItemInfoVersion } from '../../shared/lib/itemInfo'
import { slotCategory } from './slots'

// A function that gives a priority's slot choice for the filter. It re-renders its component whenever an item's lookup finishes, and gives
// undefined for an item that has not been looked up yet. A priority typed by hand has no item id and so no slot but Other (or Tier Token).
export function useSlotOf() {
  useItemInfoVersion()
  return (priority: { item: string; itemId?: number }): string | undefined => {
    if (!priority.itemId) return slotCategory(undefined, priority.item)
    const state = peekItem(priority.itemId)
    if (state?.status === 'ready') return slotCategory(itemSlotLabel(state.info.tooltip), state.info.name)
    return state?.status === 'error' ? 'Other' : undefined
  }
}
