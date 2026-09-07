import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectBandBoundaryCrossings,
  OUTPUT_PIXELS_PER_MM,
  buildDrawnBandField,
  collectDrawnContourPoints,
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

/** One boundary's worth of contour points, as the planner now takes them. */
function boundaryLine(from, to, step, seconds = 900) {
  const points = [];
  const span = Math.hypot(to[0] - from[0], to[1] - from[1]);
  for (let travelled = 0; travelled <= span; travelled += step) {
    const fraction = span === 0 ? 0 : travelled / span;
    points.push([from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction]);
  }
  return new Map([[seconds, points]]);
}

test('a value repeats along a contour long enough to carry it twice', () => {
  // An isobar or an altitude line carries its value more than once, so a
  // reader never has far to follow it.
  const labels = planRibbonContourLabels(boundaryLine([20, 300], [980, 300], 10), {
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
  for (const label of labels) {
    assert.ok(Math.abs(label.angleDegrees) < 5, `set at ${label.angleDegrees.toFixed(1)} degrees`);
  }
});

test('a line too short to sit a value on is left unlabelled', () => {
  // Dropped rather than placed badly: the reader can follow the line to the
  // next value, and a value in the wrong place is worse than an absent one.
  const labels = planRibbonContourLabels(boundaryLine([100, 100], [110, 100], 5), {
    widthPx: 400,
    heightPx: 400,
    spacingPx: 100,
    fontSize: 12,
    formatLabel: () => '15 min',
  });
  assert.deepEqual(labels, []);
});

test('labels off the frame are dropped', () => {
  const labels = planRibbonContourLabels(boundaryLine([-400, 50], [-20, 50], 5), {
    widthPx: 300,
    heightPx: 300,
    spacingPx: 80,
    fontSize: 12,
    formatLabel: () => '15 min',
  });
  assert.deepEqual(labels, []);
});

test('a band changes where its own way crosses the threshold', () => {
  // A way running east at one second per pixel, so it passes 900 s at x=900.
  // Ground belongs to the way nearest to it, so the band on this way changes
  // exactly there. Taking instead the smallest time within half a zone width
  // put the boundary half a width further out, and cut it as an arc of that
  // radius wherever a way ended.
  const halfWidthPx = 30;
  const segments = [];
  for (let x = 0; x < 1400; x += 10) {
    segments.push(x, 300, x, x + 10, 300, x + 10);
  }
  const field = buildDrawnBandField(Float64Array.from(segments), {
    originXPx: 0,
    originYPx: 0,
    scale: 1,
    widthPx: 1400,
    heightPx: 600,
    halfWidthPx,
    bandSeconds: 900,
    cellPx: 4,
  });
  const points = collectDrawnContourPoints(field).get(900);

  assert.ok(points && points.length > 0, 'the boundary was not found at all');
  const xs = points.map((point) => point[0]).sort((a, b) => a - b);
  const middle = xs[Math.floor(xs.length / 2)];
  assert.ok(
    Math.abs(middle - 900) <= 2 * field.cellPx,
    `boundary at x=${middle}, expected the way's own crossing at 900`,
  );
});

test('ground between two ways divides halfway between them', () => {
  // Two ways running east, three hundred pixels apart, one either side of a
  // band boundary. What separates their bands is the midline between them -
  // which is what the reader reads as the isoline - and not an arc at the
  // reach of either.
  const halfWidthPx = 400;
  const segments = [];
  for (let x = 0; x < 1000; x += 10) {
    segments.push(x, 100, 600, x + 10, 100, 600);
    segments.push(x, 400, 1200, x + 10, 400, 1200);
  }
  const field = buildDrawnBandField(Float64Array.from(segments), {
    originXPx: 0,
    originYPx: 0,
    scale: 1,
    widthPx: 1000,
    heightPx: 600,
    halfWidthPx,
    bandSeconds: 900,
    cellPx: 4,
  });
  const points = collectDrawnContourPoints(field).get(900);

  assert.ok(points && points.length > 0, 'the boundary between them was not found');
  const ys = points.map((point) => point[1]).sort((a, b) => a - b);
  const middle = ys[Math.floor(ys.length / 2)];
  assert.ok(
    Math.abs(middle - 250) <= 2 * field.cellPx,
    `boundary at y=${middle}, expected the midline at 250`,
  );
});
