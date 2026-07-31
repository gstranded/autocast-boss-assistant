/**
 * Compute two non-overlapping browser window bounds inside the current display.
 * Returns null when the display is too small for a usable two-column workspace.
 */
export function computeSideBySideBounds(display = {}, options = {}) {
  const left = Number(display.left ?? display.availLeft ?? 0);
  const top = Number(display.top ?? display.availTop ?? 0);
  const width = Math.floor(Number(display.width ?? display.availWidth ?? 0));
  const height = Math.floor(Number(display.height ?? display.availHeight ?? 0));
  const gap = Math.max(0, Math.floor(Number(options.gap ?? 0)));
  const minWidth = Math.max(320, Math.floor(Number(options.minWidth ?? 520)));
  const minHeight = Math.max(400, Math.floor(Number(options.minHeight ?? 600)));

  if (![left, top, width, height].every(Number.isFinite)) return null;
  if (width < minWidth * 2 + gap || height < minHeight) return null;

  const usableWidth = width - gap;
  const leftWidth = Math.floor(usableWidth / 2);
  const rightWidth = usableWidth - leftWidth;

  return {
    left: { left, top, width: leftWidth, height },
    right: { left: left + leftWidth + gap, top, width: rightWidth, height }
  };
}
