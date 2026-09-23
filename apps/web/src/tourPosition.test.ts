import { describe, expect, it } from 'vitest';
import { placeTourTooltip, type TourRect, type TourSize } from './tourPosition';

function expectVisibleAndSeparate(
  anchor: TourRect,
  tooltip: TourSize,
  viewport: TourSize,
) {
  const result = placeTourTooltip(anchor, tooltip, viewport);
  const width = Math.min(tooltip.width, result.maxWidth);
  const height = Math.min(tooltip.height, result.maxHeight);
  expect(result.left).toBeGreaterThanOrEqual(12);
  expect(result.top).toBeGreaterThanOrEqual(12);
  expect(result.left + width).toBeLessThanOrEqual(viewport.width - 12);
  expect(result.top + height).toBeLessThanOrEqual(viewport.height - 12);
  const separate =
    result.left >= anchor.left + anchor.width + 12 ||
    result.left + width <= anchor.left - 12 ||
    result.top >= anchor.top + anchor.height + 12 ||
    result.top + height <= anchor.top - 12;
  expect(separate).toBe(true);
  return result;
}

describe('placeTourTooltip', () => {
  const tooltip = { width: 340, height: 280 };

  it('anchors beside the selected tab in the reported desktop viewport', () => {
    const result = expectVisibleAndSeparate(
      { left: 262, top: 388, width: 130, height: 48 },
      tooltip,
      { width: 935, height: 763 },
    );
    expect(result).toMatchObject({
      side: 'right',
      left: 404,
      top: 388,
      arrowOffset: 24,
    });
  });

  it('flips to the left at the right edge and points at the actual tab', () => {
    const result = expectVisibleAndSeparate(
      { left: 750, top: 30, width: 140, height: 40 },
      tooltip,
      { width: 935, height: 763 },
    );
    expect(result).toMatchObject({ side: 'left', left: 398, top: 30 });
    expect(result.arrowOffset).toBe(20);
  });

  it('prefers placement below a section heading to keep navigation above clear', () => {
    const anchor = { left: 262, top: 300, width: 130, height: 40 };
    const result = placeTourTooltip(
      anchor,
      tooltip,
      { width: 935, height: 763 },
      12,
      12,
      'bottom',
    );
    expect(result).toMatchObject({ side: 'bottom', top: 352 });
    expect(result.top).toBeGreaterThan(anchor.top + anchor.height);
    expect(result.left + result.arrowOffset).toBe(
      anchor.left + anchor.width / 2,
    );
  });

  it('falls back to a side aligned with the heading when the preferred side cannot fit', () => {
    const anchor = { left: 262, top: 300, width: 130, height: 40 };
    const result = placeTourTooltip(
      anchor,
      tooltip,
      { width: 935, height: 600 },
      12,
      12,
      'bottom',
    );
    expect(result).toMatchObject({
      side: 'right',
      top: anchor.top,
      arrowOffset: 20,
    });
    expect(result.top).toBeGreaterThanOrEqual(anchor.top);
  });

  it.each([
    { left: 810, top: 680, width: 90, height: 40 },
    { left: 810, top: 340, width: 90, height: 42 },
  ])('keeps a wide card clear of the full tab bar at $top px', (anchor) => {
    const card = { width: 520, height: 560 };
    const viewport = { width: 935, height: 763 };
    const result = placeTourTooltip(anchor, card, viewport, 12, 12, 'bottom', [
      'bottom',
      'top',
    ]);
    const height = Math.min(card.height, result.maxHeight);
    expect(['bottom', 'top']).toContain(result.side);
    expect(result.left).toBeGreaterThanOrEqual(12);
    expect(result.left + card.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(result.top).toBeGreaterThanOrEqual(12);
    expect(result.top + height).toBeLessThanOrEqual(viewport.height - 12);
    // Any horizontal overlap with other tabs is safe because the entire card
    // is outside the bar's vertical span, not just outside the active tab.
    expect(
      result.top + height <= anchor.top - 12 ||
        result.top >= anchor.top + anchor.height + 12,
    ).toBe(true);
    expect(result.left + result.arrowOffset).toBe(
      anchor.left + anchor.width / 2,
    );
  });

  it('constrains a vertical card to the larger space when neither side fits', () => {
    const result = placeTourTooltip(
      { left: 800, top: 340, width: 90, height: 42 },
      { width: 520, height: 560 },
      { width: 935, height: 763 },
      12,
      12,
      'top',
      ['bottom', 'top'],
    );
    expect(result).toMatchObject({
      side: 'bottom',
      top: 394,
      maxHeight: 357,
    });
  });

  it('fits a narrow phone below the anchor without covering it', () => {
    const result = expectVisibleAndSeparate(
      { left: 12, top: 200, width: 130, height: 40 },
      tooltip,
      { width: 320, height: 700 },
    );
    expect(result).toMatchObject({
      side: 'bottom',
      left: 12,
      top: 252,
      maxWidth: 296,
      arrowOffset: 65,
    });
  });

  it('flips above a full-width anchor near the bottom of a phone', () => {
    const result = expectVisibleAndSeparate(
      { left: 12, top: 590, width: 296, height: 42 },
      tooltip,
      { width: 320, height: 700 },
    );
    expect(result).toMatchObject({ side: 'top', top: 298, arrowOffset: 148 });
  });

  it('limits the card to the best available space when no side fits fully', () => {
    const result = expectVisibleAndSeparate(
      { left: 12, top: 320, width: 296, height: 42 },
      { width: 340, height: 380 },
      { width: 320, height: 700 },
    );
    expect(result).toMatchObject({ side: 'bottom', top: 374, maxHeight: 314 });
  });

  it('follows the anchor as scrolling moves it', () => {
    const anchor = { left: 250, top: 300, width: 120, height: 40 };
    const viewport = { width: 1000, height: 800 };
    const first = placeTourTooltip(anchor, tooltip, viewport);
    const scrolled = placeTourTooltip(
      { ...anchor, top: 200 },
      tooltip,
      viewport,
    );
    expect(scrolled.side).toBe(first.side);
    expect(scrolled.top).toBe(first.top - 100);
    expect(scrolled.arrowOffset).toBe(first.arrowOffset);
  });

  it('keeps arrow tips away from rounded corners after viewport clamping', () => {
    const result = expectVisibleAndSeparate(
      { left: 250, top: 0, width: 120, height: 20 },
      tooltip,
      { width: 1000, height: 800 },
    );
    expect(result.top).toBe(12);
    expect(result.arrowOffset).toBe(16);
  });

  it('positions against the visible part of a partially scrolled anchor', () => {
    const result = placeTourTooltip(
      { left: -80, top: 100, width: 120, height: 40 },
      tooltip,
      { width: 1000, height: 800 },
    );
    expect(result).toMatchObject({ side: 'right', left: 52, top: 100 });
  });
});
