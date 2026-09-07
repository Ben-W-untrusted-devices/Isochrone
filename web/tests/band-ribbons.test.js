import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectBandBoundaryCrossings,
  OUTPUT_PIXELS_PER_MM,
  labelBoxSitsOnLine,
  planRibbonContourLabels,
  ribbonWidthPx,
  buildBandOrderedSegments,
} from '../src/render/band-ribbons.js';

/** One way, from (x0,y0) at t0 seconds to (x1,y1) at t1. */
function segment(x0, y0, t0, x1, y1, t1) {
  return [x0, y0, t0, x1, y1, t1];
}

test('a band boundary falls part way along a way, not at either end', () => {
  // The whole reason the band is a property of position rather than of node: a
  // way whose ends are minutes apart passes through a boundary somewhere in
  // the middle of it, and that is where the contour belongs.
  const segments = Float64Array.from(segment(0, 0, 600, 100, 0, 1800));
  const crossings = collectBandBoundaryCrossings(segments, 900);

  assert.equal(crossings.length, 1, 'one boundary is crossed');
  // 900 s is a quarter of the way from 600 to 1800.
  assert.equal(crossings[0].seconds, 900);
  assert.ok(Math.abs(crossings[0].x - 25) < 1e-9, `crossed at x=${crossings[0].x}`);
  assert.equal(crossings[0].y, 0);
});

test('a way that stays inside one band crosses no boundary', () => {
  const segments = Float64Array.from(segment(0, 0, 100, 50, 0, 200));
  assert.deepEqual(collectBandBoundaryCrossings(segments, 900), []);
});

test('a way is cut once per band it passes through, farthest band first', () => {
  // Four bands of 900 s, so three cuts and four pieces - and they come back
  // with the farthest first, because that is the order they have to be drawn
  // in for the nearer time to cover ground two bands both reach.
  const segments = Float64Array.from(segment(0, 0, 0, 400, 0, 3600));
  const { data, ranges } = buildBandOrderedSegments(segments, 900);

  assert.equal(data.length / 6, 4, 'four bands, four pieces');
  assert.deepEqual(ranges.map((range) => range.band), [3, 2, 1, 0]);
  assert.deepEqual(ranges.map((range) => range.count), [1, 1, 1, 1]);

  // The pieces tile the way end to end with no gap and no overlap.
  const starts = ranges.map((range) => data[range.first * 6]).sort((a, b) => a - b);
  assert.deepEqual(starts, [0, 100, 200, 300]);
});

test('nothing enumerates bands, so a field far out in time still bands', () => {
  // Ninety hours of walking is 360 bands of fifteen minutes. Under the polygon
  // model this was a loop with a ceiling on it, and everything past the
  // ceiling fell into no band at all; here a band is one division, so the
  // number of them is only ever whatever the field contains.
  const ninetyHours = 90 * 3600;
  const segments = Float64Array.from(
    segment(0, 0, ninetyHours + 100, 10, 0, ninetyHours + 1000),
  );
  const { data, ranges } = buildBandOrderedSegments(segments, 900);

  assert.equal(data.length / 6, 2, 'it spans one boundary, wherever in time it sits');
  assert.deepEqual(ranges.map((range) => range.band), [361, 360]);
  assert.equal(collectBandBoundaryCrossings(segments, 900).length, 1);
});

test('the zone width is a length on the sheet, not a count of pixels', () => {
  // 15 mm at the nominal 96 dpi is about 56.7 device pixels; at 300 dpi it is
  // about 177. The same map either way.
  assert.ok(Math.abs(ribbonWidthPx(15) - 15 * OUTPUT_PIXELS_PER_MM) < 1e-9);
  assert.ok(Math.abs(ribbonWidthPx(15, 300 / 25.4) - 177.16) < 0.01);
});

test('labels outside the frame are dropped', () => {
  const labels = planRibbonContourLabels(
    [{ x: -50, y: 10, seconds: 900, wayX: 1, wayY: 0 }],
    {
      transform: (x, y) => [x, y],
      widthPx: 100,
      heightPx: 100,
      spacingPx: 50,
      formatLabel: () => '15 min',
    },
  );
  assert.deepEqual(labels, []);
});

test('a label follows its contour, not the way that happens to cross it', () => {
  // A ring road meets a boundary running along it, not out through it. Reading
  // the angle off that road stood the label at right angles to the line it
  // belongs to; the boundary's own neighbouring crossings say where it runs.
  const crossings = [];
  for (let x = 0; x <= 300; x += 20) {
    // A contour running due east, crossed by ways pointing every which way.
    crossings.push({ x, y: 200, seconds: 900, wayX: 1, wayY: (x % 40 === 0) ? 3 : -3 });
  }
  const labels = planRibbonContourLabels(crossings, {
    transform: (x, y) => [x, y],
    widthPx: 400,
    heightPx: 400,
    spacingPx: 120,
    formatLabel: () => '15 min',
  });

  assert.ok(labels.length > 0, 'nothing was labelled');
  for (const label of labels) {
    assert.ok(
      Math.abs(label.angleDegrees) < 5,
      `label set at ${label.angleDegrees.toFixed(1)} degrees, but its contour runs level`,
    );
  }
});

/** A run of crossings along one boundary, close enough to read as one line. */
function crossingsAlong(from, to, step, seconds = 900) {
  const points = [];
  const span = Math.hypot(to[0] - from[0], to[1] - from[1]);
  for (let travelled = 0; travelled <= span; travelled += step) {
    const fraction = span === 0 ? 0 : travelled / span;
    points.push({
      x: from[0] + (to[0] - from[0]) * fraction,
      y: from[1] + (to[1] - from[1]) * fraction,
      seconds,
      wayX: 1,
      wayY: 0,
    });
  }
  return points;
}

test('a value repeats along a contour long enough to carry it twice', () => {
  // An isobar or an altitude line carries its value more than once, so a
  // reader never has far to follow it.
  const labels = planRibbonContourLabels(crossingsAlong([20, 300], [980, 300], 10), {
    transform: (x, y) => [x, y],
    widthPx: 1000,
    heightPx: 600,
    spacingPx: 200,
    fontSize: 12,
    formatLabel: () => '15 min',
  });

  assert.ok(labels.length >= 3, `only ${labels.length} labels on a 960 pixel line`);
  const xs = labels.map((label) => label.x).sort((a, b) => a - b);
  for (let index = 1; index < xs.length; index += 1) {
    assert.ok(xs[index] - xs[index - 1] >= 200, `labels ${xs[index - 1]} and ${xs[index]} crowd`);
  }
});

test('a line too short to sit a value on is left unlabelled', () => {
  // Dropped rather than placed badly: the reader can follow the line to the
  // next value, and a value in the wrong place is worse than an absent one.
  const labels = planRibbonContourLabels(crossingsAlong([100, 100], [110, 100], 5), {
    transform: (x, y) => [x, y],
    widthPx: 400,
    heightPx: 400,
    spacingPx: 100,
    fontSize: 12,
    formatLabel: () => '15 min',
  });
  assert.deepEqual(labels, []);
});

test('a box sits on its line only when the line runs in one end and out the other', () => {
  const straight = [[0, 0], [50, 0], [100, 0], [150, 0], [200, 0]];
  // Centred on the line and level with it: in at the front, out at the back.
  assert.equal(labelBoxSitsOnLine(straight, 100, 0, 0, 30, 8), true);

  // The same box turned across the line: the line now enters and leaves
  // through the long sides, which is a value written across its own contour.
  assert.equal(labelBoxSitsOnLine(straight, 100, 0, 90, 30, 8), false);

  // Set beside the line rather than on it: the line misses the box entirely.
  assert.equal(labelBoxSitsOnLine(straight, 100, 40, 0, 30, 8), false);

  // A line that turns back on itself inside the box enters and leaves through
  // the same end, which reads as a value floating in a bend.
  const hairpin = [[0, 0], [100, 0], [100, 4], [0, 4]];
  assert.equal(labelBoxSitsOnLine(hairpin, 60, 2, 0, 30, 8), false);
});
