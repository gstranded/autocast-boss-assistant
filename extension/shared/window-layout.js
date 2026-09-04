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

export function windowBoundsMatch(actual = {}, expected = {}, options = {}) {
  const positionTolerancePx = Math.max(0, Number(options.positionTolerancePx ?? options.tolerancePx ?? 40));
  const sizeTolerancePx = Math.max(0, Number(options.sizeTolerancePx ?? options.tolerancePx ?? 40));
  return ['left', 'top', 'width', 'height'].every((key) => {
    const live = Number(actual[key]);
    const want = Number(expected[key]);
    if (!Number.isFinite(live) || !Number.isFinite(want)) return false;
    const tolerance = (key === 'left' || key === 'top') ? positionTolerancePx : sizeTolerancePx;
    return Math.abs(live - want) <= tolerance;
  });
}

export function snapshotWindowBounds(win = {}) {
  const left = Number(win.left);
  const top = Number(win.top);
  const width = Number(win.width);
  const height = Number(win.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  return {
    left,
    top,
    width,
    height,
    state: String(win.state || 'normal')
  };
}
