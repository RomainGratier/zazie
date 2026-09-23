export type TourSide = 'right' | 'left' | 'bottom' | 'top';

export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TourSize {
  width: number;
  height: number;
}

export interface TourPosition {
  left: number;
  top: number;
  /** Position of the card relative to its anchor. */
  side: TourSide;
  /** Arrow position along the card's edge, measured from its top or left. */
  arrowOffset: number;
  /** Available space on this side; apply these limits to the card. */
  maxWidth: number;
  maxHeight: number;
}

const clamp = (value: number, lower: number, upper: number) =>
  Math.min(Math.max(value, lower), upper);

/** Keep the card next to its anchor, within the viewport, without covering it. */
export function placeTourTooltip(
  anchor: TourRect,
  tooltip: TourSize,
  viewport: TourSize,
  margin = 12,
  gap = 12,
  preferredSide?: TourSide,
  allowedSides?: readonly TourSide[],
): TourPosition {
  const insetX = Math.min(margin, viewport.width / 2);
  const insetY = Math.min(margin, viewport.height / 2);
  const availableWidth = Math.max(0, viewport.width - insetX * 2);
  const availableHeight = Math.max(0, viewport.height - insetY * 2);
  const width = Math.min(tooltip.width, availableWidth);
  const height = Math.min(tooltip.height, availableHeight);
  // Scroll and resize can leave an anchor partly outside the viewport.
  const left = clamp(anchor.left, 0, viewport.width);
  const right = clamp(anchor.left + anchor.width, 0, viewport.width);
  const top = clamp(anchor.top, 0, viewport.height);
  const bottom = clamp(anchor.top + anchor.height, 0, viewport.height);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  const candidates: Array<{
    side: TourSide;
    maxWidth: number;
    maxHeight: number;
  }> = [
    {
      side: 'right',
      maxWidth: Math.max(0, viewport.width - insetX - right - gap),
      maxHeight: availableHeight,
    },
    {
      side: 'left',
      maxWidth: Math.max(0, left - gap - insetX),
      maxHeight: availableHeight,
    },
    {
      side: 'bottom',
      maxWidth: availableWidth,
      maxHeight: Math.max(0, viewport.height - insetY - bottom - gap),
    },
    {
      side: 'top',
      maxWidth: availableWidth,
      maxHeight: Math.max(0, top - gap - insetY),
    },
  ];
  const allowedCandidates = allowedSides?.length
    ? candidates.filter((candidate) => allowedSides.includes(candidate.side))
    : candidates;
  const area = (candidate: (typeof candidates)[number]) =>
    Math.min(width, candidate.maxWidth) * Math.min(height, candidate.maxHeight);
  const fits = (candidate: (typeof candidates)[number]) =>
    candidate.maxWidth >= width && candidate.maxHeight >= height;
  const placement =
    allowedCandidates.find(
      (candidate) => candidate.side === preferredSide && fits(candidate),
    ) ??
    allowedCandidates.find(fits) ??
    allowedCandidates.reduce((best, candidate) =>
      area(candidate) > area(best) ? candidate : best,
    );
  const renderedWidth = Math.min(width, placement.maxWidth);
  const renderedHeight = Math.min(height, placement.maxHeight);
  let cardLeft = clamp(
    centerX - renderedWidth / 2,
    insetX,
    viewport.width - insetX - renderedWidth,
  );
  let cardTop = clamp(top, insetY, viewport.height - insetY - renderedHeight);
  switch (placement.side) {
    case 'right':
      cardLeft = right + gap;
      break;
    case 'left':
      cardLeft = left - gap - renderedWidth;
      break;
    case 'bottom':
      cardTop = bottom + gap;
      break;
    case 'top':
      cardTop = top - gap - renderedHeight;
      break;
  }
  // Even an anchor occupying the whole viewport must not place the card offscreen.
  cardLeft = clamp(cardLeft, insetX, viewport.width - insetX - renderedWidth);
  cardTop = clamp(cardTop, insetY, viewport.height - insetY - renderedHeight);
  const horizontal = placement.side === 'top' || placement.side === 'bottom';
  const edgeLength = horizontal ? renderedWidth : renderedHeight;
  const arrowInset = Math.min(16, edgeLength / 2);
  const arrowOffset = clamp(
    horizontal ? centerX - cardLeft : centerY - cardTop,
    arrowInset,
    edgeLength - arrowInset,
  );
  return {
    ...placement,
    left: cardLeft,
    top: cardTop,
    arrowOffset,
  };
}
