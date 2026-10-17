export function popoverPosition(
  anchor: { left: number; top: number; bottom: number },
  panel: { width: number; height: number },
  viewport: { left: number; top: number; width: number; height: number },
) {
  const right = viewport.left + viewport.width
  const bottom = viewport.top + viewport.height
  const below = anchor.bottom + 6
  return {
    left: Math.max(viewport.left + 12, Math.min(anchor.left, right - panel.width - 12)),
    top: Math.max(viewport.top + 12, Math.min(
      below + panel.height <= bottom - 12 ? below : anchor.top - panel.height - 6,
      bottom - panel.height - 12,
    )),
  }
}
