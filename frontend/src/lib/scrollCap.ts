/**
 * A list that shows a fixed number of rows and scrolls the rest.
 * Used by the Home food card: five rows, then a scroll bar and fades.
 */

/** Height that shows exactly `maxRows` rows, or null when every row fits. `bottoms` are row bottoms from the list top. */
export function capHeight(bottoms: readonly number[], maxRows: number): number | null {
  if (!(maxRows > 0) || bottoms.length <= maxRows) return null;
  return Math.ceil(bottoms[maxRows - 1]);
}

export interface ScrollMark {
  /** More rows above or below, so the fade on that edge shows. */
  above: boolean;
  below: boolean;
  /** Scroll bar thumb, as a percent of the track. */
  thumbTop: number;
  thumbHeight: number;
}

/** Where the thumb sits and which edges fade. One pixel of slack, since iOS reports fractional offsets. */
export function scrollMark(scrollTop: number, scrollHeight: number, clientHeight: number): ScrollMark {
  const room = scrollHeight - clientHeight;
  if (!(clientHeight > 0) || room <= 1) return { above: false, below: false, thumbTop: 0, thumbHeight: 100 };
  const top = Math.min(Math.max(scrollTop, 0), room);
  const thumbHeight = Math.max(12, (clientHeight / scrollHeight) * 100);
  return {
    above: top > 1,
    below: top < room - 1,
    thumbTop: (top / room) * (100 - thumbHeight),
    thumbHeight,
  };
}
