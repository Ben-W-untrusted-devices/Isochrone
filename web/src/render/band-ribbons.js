// The isochrone as a zone around the ways, rather than a surface over the nodes.
//
// A travel time is defined on the network, so the ground it describes is the
// ground near the network. Every reachable way is drawn as a zone of fixed
// width on the finished sheet: dense streets overlap into a filled area, a
// single rural road becomes a corridor of that same width running between two
// towns, and two places with no way between them stay apart because there is
// nothing to widen. Nothing is interpolated across ground that carries no way,
// so the map never claims a crossing the network does not have.
//
// The width is a property of the output and not of the world - it is a
// generalisation, the same decision as the weight of a road on a paper map -
// so it is stated in millimetres of finished sheet and converted by whatever
// is drawing it. Screen and print then agree about the map without agreeing
// about pixels.
//
// Time varies along a way, not per node: a rural way whose ends are eight
// minutes apart crosses a band boundary somewhere in the middle of it. So the
// band is a property of position along the way, and a boundary falls at an
// interpolated point - the same interpolation the colour renderer already
// makes, from the same buffer.

/** Width of the zone drawn around a way, on the finished sheet. */
export const RIBBON_WIDTH_MM = 15;

/** Nominal CSS reference resolution, 96 dpi: the one place mm and px meet. */
export const OUTPUT_PIXELS_PER_MM = 96 / 25.4;

/** Six floats per segment: x0, y0, seconds0, x1, y1, seconds1. */
export const RIBBON_SEGMENT_STRIDE = 6;

export function ribbonWidthPx(widthMm = RIBBON_WIDTH_MM, pixelsPerMm = OUTPUT_PIXELS_PER_MM) {
  return widthMm * pixelsPerMm;
}

/**
 * Where the ways cross a band boundary.
 *
 * One crossing per boundary per segment that spans it, carrying the point in
 * graph pixels, the boundary's own time, and the direction of the way there.
 * A contour runs across the way rather than along it, so the direction of the
 * way is the normal of the contour and the label sits square to it.
 *
 * Most segments span no boundary at all - a few seconds of walking against a
 * band of fifteen minutes - so this is far smaller than the segment list.
 */
export function collectBandBoundaryCrossings(segments, bandSeconds) {
  if (!(bandSeconds > 0)) {
    throw new Error('bandSeconds must be positive');
  }
  const crossings = [];
  for (let offset = 0; offset + 5 < segments.length; offset += RIBBON_SEGMENT_STRIDE) {
    const fromSeconds = segments[offset + 2];
    const toSeconds = segments[offset + 5];
    const lowest = Math.floor(Math.min(fromSeconds, toSeconds) / bandSeconds);
    const highest = Math.floor(Math.max(fromSeconds, toSeconds) / bandSeconds);
    if (lowest === highest) {
      continue;
    }
    const fromX = segments[offset];
    const fromY = segments[offset + 1];
    const toX = segments[offset + 3];
    const toY = segments[offset + 4];
    const span = toSeconds - fromSeconds;
    if (span === 0) {
      continue;
    }
    for (let boundary = lowest + 1; boundary <= highest; boundary += 1) {
      const seconds = boundary * bandSeconds;
      // Strictly inside the way. A boundary landing exactly on an end is the
      // start of the next way, not a crossing of this one, and counting it
      // here would place two contours on one point.
      const fraction = (seconds - fromSeconds) / span;
      if (!(fraction > 0) || !(fraction < 1)) {
        continue;
      }
      crossings.push({
        x: fromX + (toX - fromX) * fraction,
        y: fromY + (toY - fromY) * fraction,
        seconds,
        wayX: toX - fromX,
        wayY: toY - fromY,
      });
    }
  }
  return crossings;
}

/**
 * How wide a character is, as a fraction of the font size.
 *
 * A rough average for the digits and short words a value is made of, which is
 * all this needs: it sizes the box a label is tested in, and being a little
 * generous there only makes the test stricter.
 */
const LABEL_WIDTH_PER_CHARACTER = 0.55;

/** How far apart two crossings of one boundary can be and still be one line. */
const DEFAULT_CHAIN_JOIN_PX = 24;

/**
 * The crossings of one boundary, joined into the lines they lie on.
 *
 * Each crossing is a point where a way passes through a band boundary, so the
 * crossings of one boundary are samples of one contour - possibly several,
 * where the contour has separate branches. Joining each to its nearest unused
 * neighbour within a radius recovers those branches, and gives a line with a
 * direction, which is what a label needs to sit along.
 */
export function buildContourChains(points, joinRadiusPx = DEFAULT_CHAIN_JOIN_PX) {
  const cells = new Map();
  const cellOf = (x, y) => Math.floor(y / joinRadiusPx) * 73856093 + Math.floor(x / joinRadiusPx);
  points.forEach((point, index) => {
    const key = cellOf(point[0], point[1]);
    const bucket = cells.get(key);
    if (bucket === undefined) {
      cells.set(key, [index]);
    } else {
      bucket.push(index);
    }
  });

  const used = new Uint8Array(points.length);
  const nearestUnused = (fromIndex) => {
    const [x, y] = points[fromIndex];
    let best = -1;
    let bestDistance = joinRadiusPx;
    const column = Math.floor(x / joinRadiusPx);
    const row = Math.floor(y / joinRadiusPx);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const bucket = cells.get((row + dy) * 73856093 + (column + dx));
        if (bucket === undefined) {
          continue;
        }
        for (const candidate of bucket) {
          if (used[candidate] || candidate === fromIndex) {
            continue;
          }
          const distance = Math.hypot(points[candidate][0] - x, points[candidate][1] - y);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        }
      }
    }
    return best;
  };

  const chains = [];
  for (let seed = 0; seed < points.length; seed += 1) {
    if (used[seed]) {
      continue;
    }
    used[seed] = 1;
    const chain = [points[seed]];
    // Outwards from the seed in one direction, then the other, so a seed that
    // lands in the middle of a line still recovers the whole of it.
    for (const append of [true, false]) {
      let from = seed;
      for (;;) {
        const next = nearestUnused(from);
        if (next < 0) {
          break;
        }
        used[next] = 1;
        if (append) {
          chain.push(points[next]);
        } else {
          chain.unshift(points[next]);
        }
        from = next;
      }
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * Whether a box set on a line crosses it once at the front and once at the
 * back, and nowhere else.
 *
 * That is what it means for a value to sit *on* its contour: the line runs in
 * one end of the text and out of the other. A box the line enters and leaves
 * through the same side is lying alongside a line it does not belong to, and
 * one the line crosses through the top or bottom has the text across its own
 * contour rather than along it. Both read as a value floating free of any line.
 */
export function labelBoxSitsOnLine(chain, centreX, centreY, angleDegrees, halfWidth, halfHeight) {
  const angle = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Into the box's own frame, where it is an upright rectangle.
  const toLocal = (point) => {
    const dx = point[0] - centreX;
    const dy = point[1] - centreY;
    return [dx * cos + dy * sin, -dx * sin + dy * cos];
  };

  let leading = 0;
  let trailing = 0;
  let sides = 0;
  let previous = toLocal(chain[0]);
  for (let index = 1; index < chain.length; index += 1) {
    const current = toLocal(chain[index]);
    // Where this piece of line crosses each of the four edges.
    if ((previous[0] < -halfWidth) !== (current[0] < -halfWidth)) {
      const t = (-halfWidth - previous[0]) / (current[0] - previous[0]);
      if (Math.abs(previous[1] + (current[1] - previous[1]) * t) <= halfHeight) {
        leading += 1;
      }
    }
    if ((previous[0] > halfWidth) !== (current[0] > halfWidth)) {
      const t = (halfWidth - previous[0]) / (current[0] - previous[0]);
      if (Math.abs(previous[1] + (current[1] - previous[1]) * t) <= halfHeight) {
        trailing += 1;
      }
    }
    for (const edge of [-halfHeight, halfHeight]) {
      if ((previous[1] < edge) !== (current[1] < edge)) {
        const t = (edge - previous[1]) / (current[1] - previous[1]);
        if (Math.abs(previous[0] + (current[0] - previous[0]) * t) <= halfWidth) {
          sides += 1;
        }
      }
    }
    previous = current;
  }
  return leading === 1 && trailing === 1 && sides === 0;
}

/**
 * Contour labels, set along their own line and nowhere else.
 *
 * Every crossing of a boundary is a candidate; the ones that survive are those
 * whose text box the contour enters at one end and leaves at the other. Where
 * no position on a line satisfies that, the line goes unlabelled rather than
 * taking the least bad place - a value in the wrong position is worse than an
 * absent one, because the reader can follow the line to the next one, and this
 * is what a contour sheet does.
 *
 * Labels are also kept apart from one another: the crowding test is a distance
 * against what has already been placed rather than a bucket per cell, so which
 * label survives does not depend on where a grid happens to fall.
 */
export function planRibbonContourLabels(crossings, options) {
  const {
    transform,
    widthPx,
    heightPx,
    spacingPx = 220,
    formatLabel,
    fontSize = 12,
    marginPx = 0,
    chainJoinPx = DEFAULT_CHAIN_JOIN_PX,
  } = options;

  // One line per boundary, in output space, built from that boundary's own
  // crossings.
  const pointsByBoundary = new Map();
  for (const crossing of crossings) {
    const [x, y] = transform(crossing.x, crossing.y);
    const points = pointsByBoundary.get(crossing.seconds);
    if (points === undefined) {
      pointsByBoundary.set(crossing.seconds, [[x, y]]);
    } else {
      points.push([x, y]);
    }
  }

  const kept = [];
  const placed = [];
  const isCrowded = (x, y) => placed.some(
    (other) => Math.hypot(other[0] - x, other[1] - y) < spacingPx,
  );

  for (const [seconds, points] of pointsByBoundary) {
    const text = formatLabel(seconds);
    const halfWidth = (text.length * fontSize * LABEL_WIDTH_PER_CHARACTER) / 2 + fontSize * 0.3;
    const halfHeight = fontSize * 0.7;

    for (const chain of buildContourChains(points, chainJoinPx)) {
      if (chain.length < 3) {
        continue;
      }
      // Along the line, taking every position the box sits properly on that is
      // far enough from the last one taken. A contour longer than the gap
      // carries its value more than once, the way an isobar or an altitude
      // line does, so a reader never has far to follow it.
      for (let index = 1; index + 1 < chain.length; index += 1) {
        const [x, y] = chain[index];
        if (x < -marginPx || y < -marginPx || x > widthPx + marginPx || y > heightPx + marginPx) {
          continue;
        }
        if (isCrowded(x, y)) {
          continue;
        }
        const before = chain[index - 1];
        const after = chain[index + 1];
        const angleDegrees = uprightDegrees(
          (Math.atan2(after[1] - before[1], after[0] - before[0]) * 180) / Math.PI,
        );
        if (!labelBoxSitsOnLine(chain, x, y, angleDegrees, halfWidth, halfHeight)) {
          continue;
        }
        kept.push({ x, y, angleDegrees, seconds, text });
        placed.push([x, y]);
      }
    }
  }
  return kept;
}

/** Turned to within a quarter turn of level, so a value is never upside down. */
function uprightDegrees(degrees) {
  let upright = degrees;
  while (upright > 90) {
    upright -= 180;
  }
  while (upright < -90) {
    upright += 180;
  }
  return upright;
}

/**
 * The ways cut at every band boundary, gathered per band, farthest band first.
 *
 * Zones overlap: a way in the twenty-minute band and a way in the
 * twenty-five-minute band can be metres apart, and their zones - fifteen
 * millimetres wide on the sheet - cover much the same ground. What should be
 * true of that ground is the earlier of the two times, because that is when
 * you can first be there. Painting in this order makes it so without any test:
 * the nearer band is drawn last, over the farther one, so the edge between two
 * fills is the isoline itself and needs no separate line to mark it.
 *
 * One buffer with a range per band, rather than a buffer per band, so a draw
 * costs one range and the whole set is still uploaded once.
 */
export function buildBandOrderedSegments(segments, bandSeconds) {
  if (!(bandSeconds > 0)) {
    throw new Error('bandSeconds must be positive');
  }

  // Counted first, then written. Berlin yields over half a million pieces, and
  // growing an array per band to hold them was the single most expensive thing
  // the scene did - millions of boxed pushes and the collection they feed, on
  // a path that runs every time the start point moves.
  const countByBand = new Map();
  forEachBandPiece(segments, bandSeconds, (band) => {
    countByBand.set(band, (countByBand.get(band) ?? 0) + 1);
  });

  const bands = [...countByBand.keys()].sort((a, b) => b - a);
  const ranges = [];
  let first = 0;
  const cursorByBand = new Map();
  for (const band of bands) {
    const count = countByBand.get(band);
    ranges.push({ band, first, count });
    cursorByBand.set(band, first * RIBBON_SEGMENT_STRIDE);
    first += count;
  }

  const data = new Float32Array(first * RIBBON_SEGMENT_STRIDE);
  forEachBandPiece(segments, bandSeconds, (band, x0, y0, t0, x1, y1, t1) => {
    const offset = cursorByBand.get(band);
    data[offset] = x0;
    data[offset + 1] = y0;
    data[offset + 2] = t0;
    data[offset + 3] = x1;
    data[offset + 4] = y1;
    data[offset + 5] = t1;
    cursorByBand.set(band, offset + RIBBON_SEGMENT_STRIDE);
  });
  return { data, ranges };
}

/**
 * Every way cut at every band boundary it crosses, one piece at a time.
 *
 * Walked twice by the caller - once to count the pieces, once to place them -
 * because doing the arithmetic twice is far cheaper than growing an array to
 * discover the answer.
 */
function forEachBandPiece(segments, bandSeconds, visit) {
  for (let offset = 0; offset + 5 < segments.length; offset += RIBBON_SEGMENT_STRIDE) {
    const fromX = segments[offset];
    const fromY = segments[offset + 1];
    const fromSeconds = segments[offset + 2];
    const toX = segments[offset + 3];
    const toY = segments[offset + 4];
    const toSeconds = segments[offset + 5];
    if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds)) {
      continue;
    }
    const span = toSeconds - fromSeconds;
    const lowest = Math.floor(Math.min(fromSeconds, toSeconds) / bandSeconds);
    const highest = Math.floor(Math.max(fromSeconds, toSeconds) / bandSeconds);
    if (lowest === highest || span === 0) {
      visit(lowest, fromX, fromY, fromSeconds, toX, toY, toSeconds);
      continue;
    }

    // Walked in order along the way, so the pieces come out contiguous without
    // sorting a list of crossing fractions.
    const ascending = span > 0;
    let previousFraction = 0;
    for (
      let boundary = ascending ? lowest + 1 : highest;
      ascending ? boundary <= highest : boundary >= lowest + 1;
      boundary += ascending ? 1 : -1
    ) {
      const fraction = (boundary * bandSeconds - fromSeconds) / span;
      if (!(fraction > previousFraction) || !(fraction < 1)) {
        continue;
      }
      emitPiece(visit, bandSeconds, previousFraction, fraction,
        fromX, fromY, fromSeconds, toX, toY, span);
      previousFraction = fraction;
    }
    emitPiece(visit, bandSeconds, previousFraction, 1,
      fromX, fromY, fromSeconds, toX, toY, span);
  }
}

function emitPiece(visit, bandSeconds, start, end, fromX, fromY, fromSeconds, toX, toY, span) {
  if (!(end > start)) {
    return;
  }
  const startSeconds = fromSeconds + span * start;
  const endSeconds = fromSeconds + span * end;
  visit(
    Math.floor(((startSeconds + endSeconds) / 2) / bandSeconds),
    fromX + (toX - fromX) * start,
    fromY + (toY - fromY) * start,
    startSeconds,
    fromX + (toX - fromX) * end,
    fromY + (toY - fromY) * end,
    endSeconds,
  );
}
