import {
  focusRingBands,
  parseFocusRing,
  ringEdgeIsVisible,
} from '../../e2e/harness/focusRingGeometry';

const box = {
  rect: { left: 10, right: 210, top: 100, bottom: 140 },
  borderTop: 1,
  borderBottom: 1,
};

it('distinguishes the painted ring from a transparent offset and blurred shadow', () => {
  expect(
    parseFocusRing(
      'rgba(0, 0, 0, 0) 0px 0px 0px 3px, rgb(255, 255, 255) 0px 0px 0px 2px, rgb(0, 0, 0) 0px 2px 4px 0px'
    )
  ).toEqual({ color: [255, 255, 255], spread: 2, inset: false });
  expect(parseFocusRing('none')).toBeNull();
  expect(parseFocusRing('rgba(255, 255, 255, 0.2) 0px 0px 0px 2px')).toBeNull();
});

it.each([
  'rgb(255, 255, 255) 0px 0px 0px 2px inset',
  'inset rgb(255, 255, 255) 0px 0px 0px 2px',
])('samples an inset ring inside the border for %s', (shadow) => {
  expect(focusRingBands(box, parseFocusRing(shadow))).toEqual({
    left: 18,
    right: 202,
    top: { start: 101, end: 103 },
    bottom: { start: 137, end: 139 },
  });
});

it('samples an external ring outside the border without substituting the border', () => {
  expect(
    focusRingBands(box, parseFocusRing('rgb(255, 255, 255) 0px 0px 0px 2px'))
  ).toEqual({
    left: 18,
    right: 202,
    top: { start: 98, end: 100 },
    bottom: { start: 140, end: 142 },
  });
});

it('refuses missing and invalid sample geometry', () => {
  expect(focusRingBands(box, null)).toBeNull();
  expect(
    focusRingBands(
      { ...box, rect: { ...box.rect, right: NaN } },
      { color: [255, 255, 255], spread: 2, inset: false }
    )
  ).toBeNull();
});

it('rejects clipped, empty and invalid pixel evidence while retaining the ninety-percent gate', () => {
  expect(ringEdgeIsVisible({ count: 100, matching: 90 })).toBe(true);
  expect(ringEdgeIsVisible({ count: 100, matching: 89 })).toBe(false);
  expect(ringEdgeIsVisible({ count: 100, matching: 0 })).toBe(false);
  expect(ringEdgeIsVisible({ count: 0, matching: 0 })).toBe(false);
  expect(ringEdgeIsVisible({ count: 100, matching: 101 })).toBe(false);
  expect(ringEdgeIsVisible({ count: 10001, matching: 10001 })).toBe(false);
});
