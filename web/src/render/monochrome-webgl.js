// Monochrome, on the GPU.
//
// The same renderer draws both modes. Colour interpolates a travel time along
// each of a million edges and turns it into a hue; monochrome fills band
// polygons through a hatch, strokes the contours between them, and sets their
// values. Both are geometry and a fragment program, and there was never a
// reason for one to go through the GPU and the other around it - the split is
// what forced a second surface, and a canvas swap after that.
//
// Three programs:
//
//   fill    triangles, textured with a hatch tile sampled in *screen* space so
//           the pattern does not stretch with the shape it fills - the same
//           thing patternUnits="userSpaceOnUse" buys in the SVG.
//   line    contours, roads and coastline, expanded to quads on the CPU
//           because hardware line width is capped at one pixel nearly
//           everywhere and a limit-of-travel contour has to be heavier.
//   glyph   labels, from an atlas baked once, drawn with a halo pass so a
//           value stays readable over a hatch.

import { createWebGlProgram } from './isochrone-renderer.js';

const FILL_VERTEX_SOURCE = `
attribute vec2 a_position;
uniform highp vec2 u_viewportPx;
void main(void) {
  vec2 clip = (a_position / u_viewportPx) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

// The hatch is sampled from gl_FragCoord, not from an interpolated coordinate,
// which is what keeps the tile the same size everywhere on screen however
// large or small the band it fills happens to be.
const FILL_FRAGMENT_SOURCE = `
precision mediump float;
uniform sampler2D u_tile;
uniform highp vec2 u_tileSizePx;
uniform highp vec2 u_viewportPx;
uniform vec4 u_ink;
void main(void) {
  vec2 screen = vec2(gl_FragCoord.x, u_viewportPx.y - gl_FragCoord.y);
  vec4 texel = texture2D(u_tile, fract(screen / u_tileSizePx));
  if (texel.a < 0.5) {
    discard;
  }
  gl_FragColor = u_ink;
}`;

// The zone around a way.
//
// One instance per segment, and the segment stays in graph pixels: the vertex
// program expands it into a rectangle of the output width, so a pan or a zoom
// is a change of two uniforms rather than a rebuild of several million quads
// on the CPU. The rectangle is padded by the half width all round, and the
// fragment program cuts the actual zone out of it by distance - which rounds
// the ends and the joins, and makes overlapping ways merge exactly.
const RIBBON_VERTEX_SOURCE = `
attribute vec2 a_corner;
attribute vec2 a_from;
attribute float a_fromSeconds;
attribute vec2 a_to;
attribute float a_toSeconds;
uniform highp vec2 u_viewportPx;
uniform highp vec2 u_originPx;
uniform highp float u_scale;
uniform highp float u_halfWidthPx;
varying highp vec2 v_from;
varying highp vec2 v_to;
varying highp vec2 v_seconds;
void main(void) {
  vec2 from = (a_from - u_originPx) * u_scale;
  vec2 to = (a_to - u_originPx) * u_scale;
  v_from = from;
  v_to = to;
  v_seconds = vec2(a_fromSeconds, a_toSeconds);
  vec2 along = to - from;
  float length = length(along);
  vec2 direction = length > 0.0 ? along / length : vec2(1.0, 0.0);
  vec2 across = vec2(-direction.y, direction.x);
  vec2 base = a_corner.x < 0.0 ? from : to;
  vec2 screen = base
    + direction * (a_corner.x * u_halfWidthPx)
    + across * (a_corner.y * u_halfWidthPx);
  vec2 clip = (screen / u_viewportPx) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

// Three passes share this program, told apart by uniforms: the outline at a
// wider half width, the paper that covers its inside, and one pass per inked
// pattern. A fragment's band comes from its distance along the way, so a
// boundary falls mid-way exactly where the interpolated time puts it.
//
// The contour is not drawn here. It is a line across the zone, and where a way
// is shorter than the zone is wide - a 20 m street against a 15 mm zone, which
// is most of a city at any zoom that fits one on screen - the whole zone holds
// one time and there is no direction along the way to place a line by. It is
// drawn from the crossing points instead, the same geometry the export uses.
const RIBBON_FRAGMENT_SOURCE = `
precision highp float;
uniform highp vec2 u_viewportPx;
uniform highp float u_halfWidthPx;
uniform highp float u_bandSeconds;
uniform highp float u_patternCount;
uniform highp float u_patternIndex;
uniform highp vec2 u_tileSizePx;
uniform highp float u_useTile;
uniform sampler2D u_tile;
uniform vec4 u_ink;
uniform vec4 u_paper;
varying highp vec2 v_from;
varying highp vec2 v_to;
varying highp vec2 v_seconds;
void main(void) {
  vec2 screen = vec2(gl_FragCoord.x, u_viewportPx.y - gl_FragCoord.y);
  vec2 along = v_to - v_from;
  float lengthSquared = dot(along, along);
  float travelled = lengthSquared > 0.0
    ? clamp(dot(screen - v_from, along) / lengthSquared, 0.0, 1.0)
    : 0.0;
  if (distance(screen, v_from + along * travelled) > u_halfWidthPx) {
    discard;
  }
  float seconds = mix(v_seconds.x, v_seconds.y, travelled);

  if (u_patternIndex >= 0.0) {
    float band = floor(seconds / u_bandSeconds);
    if (abs(mod(band, u_patternCount) - u_patternIndex) > 0.5) {
      discard;
    }
  }
  if (u_useTile > 0.5) {
    // Paper between the strokes rather than a discard, so one pass both
    // covers what is underneath and lays the hatch on it. Discarding here
    // meant a second pass over every zone to put the paper down first.
    vec4 texel = texture2D(u_tile, fract(screen / u_tileSizePx));
    gl_FragColor = texel.a < 0.5 ? u_paper : u_ink;
    return;
  }
  gl_FragColor = u_ink;
}`;

// The travel-time field, as an image.
//
// Painting bands farthest-first faked a minimum: whichever band was drawn last
// won the ground two of them both covered. It gets the answer right in open
// country and wrong in a town, where the drawn edge of a band is its ways
// dilated by half the zone width rather than the line where the time actually
// crosses the boundary - so every edge bulged outward in arcs of that one
// radius, all curving the same way.
//
// So the minimum is taken properly, by depth test on the time itself: each way
// writes its interpolated time as depth, and the nearest in time survives. The
// result is a field, which is what a contour needs - the line can then be put
// where the field crosses a boundary and given a width in pixels, instead of
// being inferred from the outline of whatever was drawn last.
//
// The time is packed across the four bytes of a colour, because a colour
// buffer that holds floats is not available everywhere and 32 bits of fixed
// point over the range of a field is far more than enough.
const FIELD_FRAGMENT_PROLOGUE = `
vec4 packUnitFloat(float value) {
  vec4 bits = fract(value * vec4(1.0, 255.0, 65025.0, 16581375.0));
  return bits - bits.xxyz * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
}`;

const COMPOSITE_FRAGMENT_PROLOGUE = `
float unpackUnitFloat(vec4 packed) {
  return dot(packed, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}`;

/**
 * Builds the field programs in whichever dialect this context speaks.
 *
 * Writing a depth per fragment is spelled two different ways: gl_FragDepth in
 * the shading language WebGL 2 uses, and gl_FragDepthEXT behind an extension
 * in the one WebGL 1 uses. A WebGL 2 context does not offer the extension and
 * a WebGL 1 context does not know the keyword, so the whole program has to be
 * written in one dialect or the other rather than patched between them.
 *
 * Returns null where a context can do neither, and the caller keeps the older
 * ordering.
 */
function fieldShaderSources(gl) {
  const isWebGl2 = typeof gl.drawArraysInstanced === 'function';
  if (!isWebGl2) {
    const fragDepth = gl.getExtension?.('EXT_frag_depth') ?? null;
    const derivatives = gl.getExtension?.('OES_standard_derivatives') ?? null;
    if (fragDepth === null || derivatives === null) {
      return null;
    }
  }

  const dialect = isWebGl2
    ? {
      header: '#version 300 es\n',
      attribute: 'in',
      vertexOut: 'out',
      fragmentIn: 'in',
      declareColour: 'out vec4 outColour;',
      colour: 'outColour',
      sample: 'texture',
      fragDepth: 'gl_FragDepth',
    }
    : {
      header: '#extension GL_EXT_frag_depth : enable\n'
        + '#extension GL_OES_standard_derivatives : enable\n',
      attribute: 'attribute',
      vertexOut: 'varying',
      fragmentIn: 'varying',
      declareColour: '',
      colour: 'gl_FragColor',
      sample: 'texture2D',
      fragDepth: 'gl_FragDepthEXT',
    };

  const fieldVertex = `${isWebGl2 ? dialect.header : ''}
${dialect.attribute} vec2 a_corner;
${dialect.attribute} vec2 a_from;
${dialect.attribute} float a_fromSeconds;
${dialect.attribute} vec2 a_to;
${dialect.attribute} float a_toSeconds;
uniform highp vec2 u_viewportPx;
uniform highp vec2 u_originPx;
uniform highp float u_scale;
uniform highp float u_halfWidthPx;
${dialect.vertexOut} highp vec2 v_from;
${dialect.vertexOut} highp vec2 v_to;
${dialect.vertexOut} highp vec2 v_seconds;
void main(void) {
  vec2 from = (a_from - u_originPx) * u_scale;
  vec2 to = (a_to - u_originPx) * u_scale;
  v_from = from;
  v_to = to;
  v_seconds = vec2(a_fromSeconds, a_toSeconds);
  vec2 along = to - from;
  float span = length(along);
  vec2 direction = span > 0.0 ? along / span : vec2(1.0, 0.0);
  vec2 across = vec2(-direction.y, direction.x);
  vec2 base = a_corner.x < 0.0 ? from : to;
  vec2 screen = base
    + direction * (a_corner.x * u_halfWidthPx)
    + across * (a_corner.y * u_halfWidthPx);
  vec2 clip = (screen / u_viewportPx) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

  const fieldFragment = `${dialect.header}precision highp float;
uniform highp vec2 u_viewportPx;
uniform highp float u_halfWidthPx;
uniform highp float u_maxSeconds;
${dialect.fragmentIn} highp vec2 v_from;
${dialect.fragmentIn} highp vec2 v_to;
${dialect.fragmentIn} highp vec2 v_seconds;
${dialect.declareColour}
${FIELD_FRAGMENT_PROLOGUE}
void main(void) {
  vec2 screen = vec2(gl_FragCoord.x, u_viewportPx.y - gl_FragCoord.y);
  vec2 along = v_to - v_from;
  float lengthSquared = dot(along, along);
  float travelled = lengthSquared > 0.0
    ? clamp(dot(screen - v_from, along) / lengthSquared, 0.0, 1.0)
    : 0.0;
  if (distance(screen, v_from + along * travelled) > u_halfWidthPx) {
    discard;
  }
  // The nearest way wins, not the earliest.
  //
  // Keeping the smallest time within half a width made the ground belong to
  // whichever way nearby was quickest, which is a different map: it cut the
  // edge of a band as a circular arc at that radius, and let a fast road
  // crossing a slow one pull its own lower time onto the slow road's ground.
  // With the nearest way winning, the ground between two ways divides halfway
  // between them - which is the boundary between their bands - and a way's own
  // band changes exactly where its own time crosses.
  ${dialect.fragDepth} = distance(screen, v_from + along * travelled) / u_halfWidthPx;
  ${dialect.colour} = packUnitFloat(
    clamp(mix(v_seconds.x, v_seconds.y, travelled) / u_maxSeconds, 0.0, 1.0)
  );
}`;

  const compositeVertex = `${isWebGl2 ? dialect.header : ''}
${dialect.attribute} vec2 a_position;
uniform highp vec2 u_viewportPx;
void main(void) {
  vec2 clip = (a_position / u_viewportPx) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

  const compositeFragment = `${dialect.header}precision highp float;
uniform sampler2D u_field;
uniform sampler2D u_tile;
uniform highp vec2 u_viewportPx;
uniform highp vec2 u_tileSizePx;
uniform highp float u_maxSeconds;
uniform highp float u_bandSeconds;
uniform highp float u_patternCount;
uniform highp float u_contourHalfPx;
uniform highp float u_limitPx;
uniform vec4 u_ink;
uniform vec4 u_paper;
${dialect.declareColour}
${COMPOSITE_FRAGMENT_PROLOGUE}

// The band at a point, or -1 where no way came near it.
float bandAt(vec2 uv) {
  float unit = unpackUnitFloat(${dialect.sample}(u_field, uv));
  return unit > 0.9999 ? -1.0 : floor(unit * u_maxSeconds / u_bandSeconds);
}

void main(void) {
  vec2 uv = gl_FragCoord.xy / u_viewportPx;
  float band = bandAt(uv);
  if (band < 0.0) {
    discard;
  }
  vec2 screen = vec2(gl_FragCoord.x, u_viewportPx.y - gl_FragCoord.y);

  // The limit of travel: covered ground with uncovered ground beside it.
  vec2 edge = u_limitPx / u_viewportPx;
  if (
    bandAt(uv + vec2(edge.x, 0.0)) < 0.0 || bandAt(uv - vec2(edge.x, 0.0)) < 0.0
    || bandAt(uv + vec2(0.0, edge.y)) < 0.0 || bandAt(uv - vec2(0.0, edge.y)) < 0.0
  ) {
    ${dialect.colour} = u_ink;
    return;
  }

  // A contour wherever the band changes between one point and the next.
  //
  // Not a distance from the boundary divided by the rate the time is changing:
  // this field steps rather than slopes - it jumps where a different way
  // becomes the nearest in time - and across a step that rate is meaningless
  // and made the line as wide as the step was large.
  //
  // The reach is at least one whole pixel of the field. Below that the four
  // samples land back in the same texel as the fragment, every band comes out
  // equal to its own, and the line disappears everywhere except the outer
  // edge, which is found by a different test at a wider radius.
  vec2 reach = max(u_contourHalfPx, 1.0) / u_viewportPx;
  float left = bandAt(uv - vec2(reach.x, 0.0));
  float right = bandAt(uv + vec2(reach.x, 0.0));
  float below = bandAt(uv - vec2(0.0, reach.y));
  float above = bandAt(uv + vec2(0.0, reach.y));
  if (
    (left >= 0.0 && left != band) || (right >= 0.0 && right != band)
    || (below >= 0.0 && below != band) || (above >= 0.0 && above != band)
  ) {
    ${dialect.colour} = u_ink;
    return;
  }
  if (mod(band, u_patternCount) < 0.5) {
    ${dialect.colour} = u_paper;
    return;
  }
  vec4 texel = ${dialect.sample}(u_tile, fract(screen / u_tileSizePx));
  ${dialect.colour} = texel.a < 0.5 ? u_paper : u_ink;
}`;

  return { fieldVertex, fieldFragment, compositeVertex, compositeFragment };
}

// A plain stroked line, one instance per segment.
//
// The same expansion the zones use, without the field: the segment stays in
// graph pixels and the vertex program widens it in output space. Roads are
// what this is for. Culling them to the frame and widening them into quads on
// the CPU cost more the further in you zoomed, because that is where the finer
// road classes switch on - hundreds of thousands of segments rebuilt for every
// frame of a drag, which is exactly the wrong way round.
const STROKE_VERTEX_SOURCE = `
attribute vec2 a_corner;
attribute vec2 a_from;
attribute vec2 a_to;
uniform highp vec2 u_viewportPx;
uniform highp vec2 u_originPx;
uniform highp float u_scale;
uniform highp float u_halfWidthPx;
varying highp vec2 v_from;
varying highp vec2 v_to;
void main(void) {
  vec2 from = (a_from - u_originPx) * u_scale;
  vec2 to = (a_to - u_originPx) * u_scale;
  v_from = from;
  v_to = to;
  vec2 along = to - from;
  float span = length(along);
  vec2 direction = span > 0.0 ? along / span : vec2(1.0, 0.0);
  vec2 across = vec2(-direction.y, direction.x);
  vec2 base = a_corner.x < 0.0 ? from : to;
  vec2 screen = base
    + direction * (a_corner.x * u_halfWidthPx)
    + across * (a_corner.y * u_halfWidthPx);
  vec2 clip = (screen / u_viewportPx) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const STROKE_FRAGMENT_SOURCE = `
precision highp float;
uniform highp vec2 u_viewportPx;
uniform highp float u_halfWidthPx;
uniform vec4 u_ink;
varying highp vec2 v_from;
varying highp vec2 v_to;
void main(void) {
  vec2 screen = vec2(gl_FragCoord.x, u_viewportPx.y - gl_FragCoord.y);
  vec2 along = v_to - v_from;
  float lengthSquared = dot(along, along);
  float travelled = lengthSquared > 0.0
    ? clamp(dot(screen - v_from, along) / lengthSquared, 0.0, 1.0)
    : 0.0;
  if (distance(screen, v_from + along * travelled) > u_halfWidthPx) {
    discard;
  }
  gl_FragColor = u_ink;
}`;

const LINE_VERTEX_SOURCE = FILL_VERTEX_SOURCE;
const LINE_FRAGMENT_SOURCE = `
precision mediump float;
uniform vec4 u_ink;
void main(void) {
  gl_FragColor = u_ink;
}`;

const GLYPH_VERTEX_SOURCE = `
attribute vec2 a_position;
attribute vec2 a_uv;
uniform highp vec2 u_viewportPx;
varying vec2 v_uv;
void main(void) {
  v_uv = a_uv;
  vec2 clip = (a_position / u_viewportPx) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const GLYPH_FRAGMENT_SOURCE = `
precision mediump float;
uniform sampler2D u_atlas;
uniform vec4 u_ink;
varying vec2 v_uv;
void main(void) {
  float coverage = texture2D(u_atlas, v_uv).a;
  if (coverage < 0.02) {
    discard;
  }
  gl_FragColor = vec4(u_ink.rgb, u_ink.a * coverage);
}`;

function parseCssColour(colour) {
  const hex = String(colour).trim().replace('#', '');
  if (hex.length === 6) {
    return [
      Number.parseInt(hex.slice(0, 2), 16) / 255,
      Number.parseInt(hex.slice(2, 4), 16) / 255,
      Number.parseInt(hex.slice(4, 6), 16) / 255,
      1,
    ];
  }
  return [0, 0, 0, 1];
}

/**
 * A hatch tile as a texture.
 *
 * Baked from the same declarative line list the SVG pattern is written from,
 * so the two cannot drift into different textures. Cached per pattern and
 * scale, because a tile is fixed for the life of a context.
 */
function getOrCreateTileTexture(state, pattern, scale, ink) {
  const key = `${pattern.id}|${scale}|${ink}`;
  const cached = state.tiles.get(key);
  if (cached) {
    return cached;
  }
  const { gl, createCanvas } = state;
  const size = Math.max(1, Math.round(pattern.tileSize * scale));
  const tile = createCanvas(size, size);
  const context = tile.getContext('2d');
  if (!context) {
    return null;
  }
  context.clearRect(0, 0, size, size);
  context.strokeStyle = ink;
  context.lineWidth = Math.max(1, pattern.strokeWidth * scale);
  context.beginPath();
  for (const line of pattern.lines) {
    context.moveTo(line.x1 * scale, line.y1 * scale);
    context.lineTo(line.x2 * scale, line.y2 * scale);
  }
  context.stroke();

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const entry = { texture, sizePx: size };
  state.tiles.set(key, entry);
  return entry;
}

/**
 * Expands a polyline into triangles of a given width.
 *
 * Hardware line width is capped at one pixel on nearly every implementation,
 * and a limit-of-travel contour has to be visibly heavier than a band edge, so
 * width is built into the geometry rather than asked of the driver.
 */
function appendThickPolyline(target, points, transform, widthPx, closed) {
  const half = Math.max(0.5, widthPx / 2);
  const count = points.length / 2;
  const last = closed ? count : count - 1;
  for (let index = 0; index < last; index += 1) {
    const next = (index + 1) % count;
    const [x0, y0] = transform(points[index * 2], points[index * 2 + 1]);
    const [x1, y1] = transform(points[next * 2], points[next * 2 + 1]);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) {
      continue;
    }
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    target.push(
      x0 - nx, y0 - ny, x0 + nx, y0 + ny, x1 + nx, y1 + ny,
      x0 - nx, y0 - ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny,
    );
  }
}

// Everything a contour value is ever spelled with. Baking a fixed set once
// beats measuring text per frame, and the labels are numbers and units.
const GLYPH_CHARSET = '0123456789 hmin';
const HALO_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * The charset drawn once into a texture, with where each character sits.
 *
 * WebGL has no text, so the alternative to an atlas is uploading a
 * canvas-sized image every frame. A strip of fifteen glyphs is uploaded once
 * per context and serves every label at every zoom.
 */
function getOrCreateGlyphAtlas(state, fontSize) {
  const key = `atlas|${fontSize}`;
  const cached = state.tiles.get(key);
  if (cached) {
    return cached;
  }
  const { gl, createCanvas } = state;
  // Baked oversized and drawn back down, so type stays clean at an angle.
  const scale = 2;
  const cellHeight = Math.ceil(fontSize * scale * 1.4);
  const probeCanvas = createCanvas(8, 8);
  const probe = probeCanvas.getContext('2d');
  if (!probe) {
    return null;
  }
  const font = `${fontSize * scale}px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  probe.font = font;
  const widths = [...GLYPH_CHARSET].map((c) => Math.ceil(probe.measureText(c).width));
  const totalWidth = widths.reduce((sum, width) => sum + width + 2, 0);

  const canvas = createCanvas(totalWidth, cellHeight);
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.clearRect(0, 0, totalWidth, cellHeight);
  context.font = font;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  const glyphs = new Map();
  let cursor = 0;
  [...GLYPH_CHARSET].forEach((character, index) => {
    context.fillText(character, cursor + 1, cellHeight / 2);
    glyphs.set(character, {
      u0: cursor / totalWidth,
      u1: (cursor + widths[index] + 2) / totalWidth,
      advance: (widths[index] + 2) / scale,
    });
    cursor += widths[index] + 2;
  });

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const atlas = { texture, glyphs, cellHeight: cellHeight / scale };
  state.tiles.set(key, atlas);
  return atlas;
}

/**
 * Quads for one label, centred on its anchor and turned with the contour.
 *
 * `offsetPx` shifts the whole string, which is how the halo is drawn without a
 * second atlas.
 */
export function appendLabelQuads(target, label, atlas, offsetPx = [0, 0]) {
  const characters = [...label.text].filter((character) => atlas.glyphs.has(character));
  if (characters.length === 0) {
    return;
  }
  const totalWidth = characters.reduce(
    (sum, character) => sum + atlas.glyphs.get(character).advance, 0,
  );
  const angle = ((label.angleDegrees ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfHeight = atlas.cellHeight / 2;
  let cursor = -totalWidth / 2;

  for (const character of characters) {
    const glyph = atlas.glyphs.get(character);
    const left = cursor;
    const right = cursor + glyph.advance;
    cursor = right;
    const corners = [
      [left, -halfHeight, glyph.u0, 0],
      [right, -halfHeight, glyph.u1, 0],
      [right, halfHeight, glyph.u1, 1],
      [left, -halfHeight, glyph.u0, 0],
      [right, halfHeight, glyph.u1, 1],
      [left, halfHeight, glyph.u0, 1],
    ];
    for (const [localX, localY, u, v] of corners) {
      target.push(
        label.x + offsetPx[0] + localX * cos - localY * sin,
        label.y + offsetPx[1] + localX * sin + localY * cos,
        u,
        v,
      );
    }
  }
}

export { FILL_FRAGMENT_SOURCE, FILL_VERTEX_SOURCE, appendThickPolyline, parseCssColour };

/** Sets up the three programs and their buffers on a context. */
export function createMonochromeWebGlPainter(gl, options = {}) {
  const createCanvas = options.createCanvas
    ?? ((width, height) => {
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    });

  // Instancing is what keeps the ways in graph space. Core in WebGL 2, an
  // extension in WebGL 1 that has been present on essentially every
  // implementation for a decade; without it there is no ribbon program and the
  // caller falls back to the 2D renderer.
  const instancing = resolveInstancing(gl);
  const fillProgram = createWebGlProgram(gl, FILL_VERTEX_SOURCE, FILL_FRAGMENT_SOURCE);
  const lineProgram = createWebGlProgram(gl, LINE_VERTEX_SOURCE, LINE_FRAGMENT_SOURCE);
  const glyphProgram = createWebGlProgram(gl, GLYPH_VERTEX_SOURCE, GLYPH_FRAGMENT_SOURCE);

  const ribbonProgram = instancing === null
    ? null
    : createWebGlProgram(gl, RIBBON_VERTEX_SOURCE, RIBBON_FRAGMENT_SOURCE);

  // The field path needs a per-fragment depth and screen-space derivatives.
  // Without either, the older ordering is what draws.
  const strokeProgram = instancing === null
    ? null
    : createWebGlProgram(gl, STROKE_VERTEX_SOURCE, STROKE_FRAGMENT_SOURCE);
  const fieldSources = instancing === null ? null : fieldShaderSources(gl);
  // A context that cannot build these still has the older ordering, so a
  // failure here is a fallback rather than a broken renderer.
  let fieldProgram = null;
  let compositeProgram = null;
  if (fieldSources !== null) {
    try {
      fieldProgram = createWebGlProgram(gl, fieldSources.fieldVertex, fieldSources.fieldFragment);
      compositeProgram = createWebGlProgram(
        gl, fieldSources.compositeVertex, fieldSources.compositeFragment,
      );
    } catch (error) {
      console.warn('monochrome field programs unavailable; drawing bands in order', error);
      fieldProgram = null;
      compositeProgram = null;
    }
  }

  const state = {
    gl,
    createCanvas,
    instancing,
    tiles: new Map(),
    buffer: gl.createBuffer(),
    glyphBuffer: gl.createBuffer(),
    ribbonBuffer: gl.createBuffer(),
    ribbonCornerBuffer: gl.createBuffer(),
    ribbonSegments: null,
    strokeBuffer: gl.createBuffer(),
    strokeSource: null,
    stroke: strokeProgram === null ? null : {
      program: strokeProgram,
      corner: gl.getAttribLocation(strokeProgram, 'a_corner'),
      from: gl.getAttribLocation(strokeProgram, 'a_from'),
      to: gl.getAttribLocation(strokeProgram, 'a_to'),
      viewport: gl.getUniformLocation(strokeProgram, 'u_viewportPx'),
      origin: gl.getUniformLocation(strokeProgram, 'u_originPx'),
      scale: gl.getUniformLocation(strokeProgram, 'u_scale'),
      halfWidth: gl.getUniformLocation(strokeProgram, 'u_halfWidthPx'),
      ink: gl.getUniformLocation(strokeProgram, 'u_ink'),
    },
    field: fieldProgram === null ? null : {
      program: fieldProgram,
      corner: gl.getAttribLocation(fieldProgram, 'a_corner'),
      from: gl.getAttribLocation(fieldProgram, 'a_from'),
      fromSeconds: gl.getAttribLocation(fieldProgram, 'a_fromSeconds'),
      to: gl.getAttribLocation(fieldProgram, 'a_to'),
      toSeconds: gl.getAttribLocation(fieldProgram, 'a_toSeconds'),
      viewport: gl.getUniformLocation(fieldProgram, 'u_viewportPx'),
      origin: gl.getUniformLocation(fieldProgram, 'u_originPx'),
      scale: gl.getUniformLocation(fieldProgram, 'u_scale'),
      halfWidth: gl.getUniformLocation(fieldProgram, 'u_halfWidthPx'),
      maxSeconds: gl.getUniformLocation(fieldProgram, 'u_maxSeconds'),
    },
    composite: compositeProgram === null ? null : {
      program: compositeProgram,
      position: gl.getAttribLocation(compositeProgram, 'a_position'),
      viewport: gl.getUniformLocation(compositeProgram, 'u_viewportPx'),
      fieldTexture: gl.getUniformLocation(compositeProgram, 'u_field'),
      tile: gl.getUniformLocation(compositeProgram, 'u_tile'),
      tileSize: gl.getUniformLocation(compositeProgram, 'u_tileSizePx'),
      maxSeconds: gl.getUniformLocation(compositeProgram, 'u_maxSeconds'),
      bandSeconds: gl.getUniformLocation(compositeProgram, 'u_bandSeconds'),
      patternCount: gl.getUniformLocation(compositeProgram, 'u_patternCount'),
      contourHalf: gl.getUniformLocation(compositeProgram, 'u_contourHalfPx'),
      limit: gl.getUniformLocation(compositeProgram, 'u_limitPx'),
      ink: gl.getUniformLocation(compositeProgram, 'u_ink'),
      paper: gl.getUniformLocation(compositeProgram, 'u_paper'),
    },
    fieldTarget: null,
    ribbon: ribbonProgram === null ? null : {
      program: ribbonProgram,
      corner: gl.getAttribLocation(ribbonProgram, 'a_corner'),
      from: gl.getAttribLocation(ribbonProgram, 'a_from'),
      fromSeconds: gl.getAttribLocation(ribbonProgram, 'a_fromSeconds'),
      to: gl.getAttribLocation(ribbonProgram, 'a_to'),
      toSeconds: gl.getAttribLocation(ribbonProgram, 'a_toSeconds'),
      viewport: gl.getUniformLocation(ribbonProgram, 'u_viewportPx'),
      origin: gl.getUniformLocation(ribbonProgram, 'u_originPx'),
      scale: gl.getUniformLocation(ribbonProgram, 'u_scale'),
      halfWidth: gl.getUniformLocation(ribbonProgram, 'u_halfWidthPx'),
      bandSeconds: gl.getUniformLocation(ribbonProgram, 'u_bandSeconds'),
      patternCount: gl.getUniformLocation(ribbonProgram, 'u_patternCount'),
      patternIndex: gl.getUniformLocation(ribbonProgram, 'u_patternIndex'),
      tileSize: gl.getUniformLocation(ribbonProgram, 'u_tileSizePx'),
      useTile: gl.getUniformLocation(ribbonProgram, 'u_useTile'),
      tile: gl.getUniformLocation(ribbonProgram, 'u_tile'),
      ink: gl.getUniformLocation(ribbonProgram, 'u_ink'),
      paper: gl.getUniformLocation(ribbonProgram, 'u_paper'),
    },
    fill: {
      program: fillProgram,
      position: gl.getAttribLocation(fillProgram, 'a_position'),
      viewport: gl.getUniformLocation(fillProgram, 'u_viewportPx'),
      tile: gl.getUniformLocation(fillProgram, 'u_tile'),
      tileSize: gl.getUniformLocation(fillProgram, 'u_tileSizePx'),
      ink: gl.getUniformLocation(fillProgram, 'u_ink'),
    },
    line: {
      program: lineProgram,
      position: gl.getAttribLocation(lineProgram, 'a_position'),
      viewport: gl.getUniformLocation(lineProgram, 'u_viewportPx'),
      ink: gl.getUniformLocation(lineProgram, 'u_ink'),
    },
    glyph: {
      program: glyphProgram,
      position: gl.getAttribLocation(glyphProgram, 'a_position'),
      uv: gl.getAttribLocation(glyphProgram, 'a_uv'),
      viewport: gl.getUniformLocation(glyphProgram, 'u_viewportPx'),
      atlas: gl.getUniformLocation(glyphProgram, 'u_atlas'),
      ink: gl.getUniformLocation(glyphProgram, 'u_ink'),
    },
  };
  return state;
}

/**
 * Instanced drawing, whichever way this context provides it.
 *
 * Returns null when neither is available, which is the one case the ribbon
 * program cannot be built for.
 */
function resolveInstancing(gl) {
  if (typeof gl.drawArraysInstanced === 'function' && typeof gl.vertexAttribDivisor === 'function') {
    return {
      divisor: (location, divisor) => gl.vertexAttribDivisor(location, divisor),
      draw: (mode, first, count, instances) =>
        gl.drawArraysInstanced(mode, first, count, instances),
    };
  }
  const extension = gl.getExtension?.('ANGLE_instanced_arrays') ?? null;
  if (extension === null) {
    return null;
  }
  return {
    divisor: (location, divisor) => extension.vertexAttribDivisorANGLE(location, divisor),
    draw: (mode, first, count, instances) =>
      extension.drawArraysInstancedANGLE(mode, first, count, instances),
  };
}

// The padded rectangle every segment is expanded into, as two triangles: the
// first coordinate runs along the way, the second across it.
const RIBBON_CORNERS = Float32Array.of(
  -1, -1, 1, -1, 1, 1,
  -1, -1, 1, 1, -1, 1,
);

/**
 * Uploads the ways once and points the ribbon program at them.
 *
 * The segment buffer is the colour renderer's own edge vertex data, unchanged:
 * six floats per segment, being both ends in graph pixels with the travel time
 * at each. Nothing is repacked, so the two modes cannot drift into describing
 * different journeys.
 */
function bindRibbonSegments(state, segments, firstInstance, program) {
  const { gl, instancing } = state;
  const ribbon = program ?? state.ribbon;
  if (state.ribbonSegments !== segments) {
    gl.bindBuffer(gl.ARRAY_BUFFER, state.ribbonBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, segments, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.ribbonCornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, RIBBON_CORNERS, gl.STATIC_DRAW);
    state.ribbonSegments = segments;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, state.ribbonCornerBuffer);
  gl.enableVertexAttribArray(ribbon.corner);
  gl.vertexAttribPointer(ribbon.corner, 2, gl.FLOAT, false, 0, 0);
  instancing.divisor(ribbon.corner, 0);

  // The instance range is chosen by moving the attribute offsets rather than
  // by a first-instance argument, which WebGL's instanced draw does not take.
  const stride = 24;
  const base = firstInstance * stride;
  gl.bindBuffer(gl.ARRAY_BUFFER, state.ribbonBuffer);
  for (const [location, size, offset] of [
    [ribbon.from, 2, 0],
    [ribbon.fromSeconds, 1, 8],
    [ribbon.to, 2, 12],
    [ribbon.toSeconds, 1, 20],
  ]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, base + offset);
    instancing.divisor(location, 1);
  }
}

/** One pass over a range of the ways, with whatever this pass is drawing. */
function drawRibbonPass(state, scene, viewport, pass) {
  const { gl, ribbon, instancing } = state;
  const segments = scene.ribbons.ordered.data;
  const instances = Math.floor(segments.length / 6);
  gl.uniform2f(ribbon.viewport, viewport[0], viewport[1]);
  gl.uniform2f(ribbon.origin, scene.frame.offsetXPx, scene.frame.offsetYPx);
  gl.uniform1f(ribbon.scale, scene.frame.effectiveScale);
  gl.uniform1f(ribbon.halfWidth, pass.halfWidthPx);
  gl.uniform1f(ribbon.bandSeconds, scene.ribbons.bandSeconds);
  gl.uniform1f(ribbon.patternCount, scene.ribbons.patterns.length);
  gl.uniform1f(ribbon.patternIndex, -1);
  gl.uniform4fv(ribbon.ink, pass.ink);
  gl.uniform4fv(ribbon.paper, pass.paper ?? pass.ink);
  if (pass.tile) {
    gl.uniform1f(ribbon.useTile, 1);
    gl.uniform2f(ribbon.tileSize, pass.tile.sizePx, pass.tile.sizePx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pass.tile.texture);
    gl.uniform1i(ribbon.tile, 0);
  } else {
    gl.uniform1f(ribbon.useTile, 0);
  }
  void instances;
  instancing.draw(gl.TRIANGLES, 0, 6, pass.count);
}

/**
 * The isochrone, as a zone of fixed output width around every reachable way.
 *
 * Three passes, in this order because each covers the one before it where they
 * overlap: the outline, drawn wider than the zone so only the outside of the
 * union survives; the paper that covers its inside; and one pass for each
 * inked pattern, which draws only the bands that pattern belongs to.
 */
/**
 * An offscreen surface the size of the view, holding the field.
 *
 * A colour attachment for the packed time and a depth attachment to take the
 * minimum with. Kept between frames and rebuilt only when the view changes
 * size.
 */
function getOrCreateFieldTarget(state, widthPx, heightPx) {
  const { gl } = state;
  const existing = state.fieldTarget;
  if (existing && existing.widthPx === widthPx && existing.heightPx === heightPx) {
    return existing;
  }
  if (existing) {
    gl.deleteFramebuffer(existing.framebuffer);
    gl.deleteTexture(existing.texture);
    gl.deleteRenderbuffer(existing.depth);
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, widthPx, heightPx, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  // Nearest, because the packed bytes of a time are not a colour and must not
  // be averaged with a neighbour's.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, widthPx, heightPx);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    gl.deleteRenderbuffer(depth);
    state.fieldTarget = null;
    return null;
  }

  state.fieldTarget = { framebuffer, texture, depth, widthPx, heightPx };
  return state.fieldTarget;
}

/**
 * The isochrone, from the field rather than from an order of painting.
 *
 * One pass puts every way into the offscreen surface, each fragment keeping
 * the smallest travel time of the ways covering it - which is the time you can
 * first be there, and is what the map is claiming. A second pass reads that
 * back and decides everything from it: which band a point is in, where a
 * contour runs and how wide, and where the limit of travel is.
 */
function drawRibbonsFromField(state, scene, viewport, ink, paper) {
  const { gl, field, composite } = state;
  const target = getOrCreateFieldTarget(state, viewport[0], viewport[1]);
  if (target === null) {
    return null;
  }
  // The ways as routing left them, uncut: a fragment's band comes from its own
  // interpolated time, so nothing here depends on where a boundary falls.
  const { segments, patterns, widthPx, outlinePx } = scene.ribbons;
  const total = Math.floor(segments.length / 6);
  const maxSeconds = Math.max(scene.ribbons.maxSeconds ?? 0, scene.ribbons.bandSeconds) * 1.05;

  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.viewport(0, 0, viewport[0], viewport[1]);
  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true);
  // White is the far end of the range, so ground no way reaches reads as
  // empty rather than as the origin.
  gl.clearColor(1, 1, 1, 1);
  gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(field.program);
  bindRibbonSegments(state, segments, 0, field);
  gl.uniform2f(field.viewport, viewport[0], viewport[1]);
  gl.uniform2f(field.origin, scene.frame.offsetXPx, scene.frame.offsetYPx);
  gl.uniform1f(field.scale, scene.frame.effectiveScale);
  gl.uniform1f(field.halfWidth, widthPx / 2);
  gl.uniform1f(field.maxSeconds, maxSeconds);
  state.instancing.draw(gl.TRIANGLES, 0, 6, total);
  releaseRibbonAttributes(state, field);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, viewport[0], viewport[1]);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.enable(gl.BLEND);

  const hatched = patterns.find((pattern) => pattern.lines.length > 0) ?? patterns[0];
  const tile = getOrCreateTileTexture(state, hatched, scene.patternScale, scene.ink);
  gl.useProgram(composite.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, Float32Array.of(
    0, 0, viewport[0], 0, viewport[0], viewport[1],
    0, 0, viewport[0], viewport[1], 0, viewport[1],
  ), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(composite.position);
  gl.vertexAttribPointer(composite.position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(composite.viewport, viewport[0], viewport[1]);
  gl.uniform1f(composite.maxSeconds, maxSeconds);
  gl.uniform1f(composite.bandSeconds, scene.ribbons.bandSeconds);
  gl.uniform1f(composite.patternCount, patterns.length);
  gl.uniform1f(composite.contourHalf, scene.contourStrokeWidth / 2);
  gl.uniform1f(composite.limit, Math.max(1, outlinePx * 2));
  gl.uniform4fv(composite.ink, ink);
  gl.uniform4fv(composite.paper, paper);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.uniform1i(composite.fieldTexture, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tile ? tile.texture : null);
  gl.uniform1i(composite.tile, 1);
  gl.uniform2f(composite.tileSize, tile ? tile.sizePx : 1, tile ? tile.sizePx : 1);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.activeTexture(gl.TEXTURE0);
  return total;
}

function drawRibbons(state, scene, viewport, ink, paper) {
  const { gl, ribbon } = state;
  // Tested on the ways themselves, not on the cut form, so asking whether
  // there is anything to draw does not do the cutting.
  if (!ribbon || !scene.ribbons || scene.ribbons.segments.length < 6) {
    return 0;
  }
  if (state.field && state.composite) {
    const drawn = drawRibbonsFromField(state, scene, viewport, ink, paper);
    if (drawn !== null) {
      return drawn;
    }
  }
  const { ordered, patterns, widthPx, outlinePx } = scene.ribbons;
  const half = widthPx / 2;
  const total = Math.floor(ordered.data.length / 6);
  gl.useProgram(ribbon.program);

  // The outline of the union, in one pass over everything: drawn wider than
  // the zone, so all of it that survives is the outside edge.
  bindRibbonSegments(state, ordered.data, 0);
  drawRibbonPass(state, scene, viewport, {
    halfWidthPx: half + scene.contourStrokeWidth * 2.2,
    count: total,
    ink,
  });

  // Then band by band, farthest first, so the nearer time is what covers any
  // ground two bands both reach.
  for (const range of ordered.ranges) {
    if (range.count === 0) {
      continue;
    }
    bindRibbonSegments(state, ordered.data, range.first);
    // Each band outlined before it is filled. A nearer band covers the outline
    // of the farther one everywhere except along their shared edge, so what
    // survives is a line exactly on each band boundary - the isoline - with
    // the heavier line already laid down outside them all for the limit of
    // travel.
    drawRibbonPass(state, scene, viewport, {
      halfWidthPx: half + outlinePx,
      count: range.count,
      ink,
    });
    const pattern = patterns[((range.band % patterns.length) + patterns.length) % patterns.length];
    const tile = pattern.lines.length === 0
      ? null
      : getOrCreateTileTexture(state, pattern, scene.patternScale, scene.ink);
    drawRibbonPass(state, scene, viewport, {
      halfWidthPx: half,
      count: range.count,
      tile,
      ink: tile ? ink : paper,
      paper,
    });
  }
  releaseRibbonAttributes(state);
  return total;
}

/**
 * Puts the instancing divisors back.
 *
 * They are state of the attribute index, not of the program, so leaving them
 * set made every later program read its second attribute once per instance
 * instead of once per vertex - which collapsed each label to nothing while
 * leaving the single-attribute line program working, and so looked like the
 * labels had stopped being produced rather than stopped being drawn.
 */
function releaseRibbonAttributes(state, program) {
  const { gl, instancing } = state;
  const ribbon = program ?? state.ribbon;
  for (const location of [ribbon.from, ribbon.fromSeconds, ribbon.to, ribbon.toSeconds]) {
    if (location >= 0) {
      instancing.divisor(location, 0);
      gl.disableVertexAttribArray(location);
    }
  }
  if (ribbon.corner >= 0) {
    gl.disableVertexAttribArray(ribbon.corner);
  }
}

/**
 * Strokes segments held in graph pixels, widened on the GPU.
 *
 * Uploaded once and kept while the same array is being drawn, so panning and
 * zooming change two uniforms and nothing else. Everything off the frame is
 * clipped by the hardware, which is cheaper than deciding on the CPU what to
 * leave out.
 */
function drawInstancedStrokes(state, segments, frame, widthPx, ink, viewport) {
  const { gl, stroke, instancing } = state;
  if (!stroke || !segments || segments.length < 4) {
    return;
  }
  gl.useProgram(stroke.program);

  if (state.strokeSource !== segments) {
    gl.bindBuffer(gl.ARRAY_BUFFER, state.strokeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, segments, gl.STATIC_DRAW);
    state.strokeSource = segments;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, state.ribbonCornerBuffer);
  gl.enableVertexAttribArray(stroke.corner);
  gl.vertexAttribPointer(stroke.corner, 2, gl.FLOAT, false, 0, 0);
  instancing.divisor(stroke.corner, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, state.strokeBuffer);
  for (const [location, offset] of [[stroke.from, 0], [stroke.to, 8]]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset);
    instancing.divisor(location, 1);
  }

  gl.uniform2f(stroke.viewport, viewport[0], viewport[1]);
  gl.uniform2f(stroke.origin, frame.offsetXPx, frame.offsetYPx);
  gl.uniform1f(stroke.scale, frame.effectiveScale);
  gl.uniform1f(stroke.halfWidth, Math.max(0.5, widthPx / 2));
  gl.uniform4fv(stroke.ink, ink);
  instancing.draw(gl.TRIANGLES, 0, 6, Math.floor(segments.length / 4));

  for (const location of [stroke.from, stroke.to]) {
    if (location >= 0) {
      instancing.divisor(location, 0);
      gl.disableVertexAttribArray(location);
    }
  }
  if (stroke.corner >= 0) {
    gl.disableVertexAttribArray(stroke.corner);
  }
}

function drawTriangles(state, vertices, ink, viewport) {
  if (vertices.length < 6) {
    return;
  }
  const { gl, line } = state;
  gl.useProgram(line.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(line.position);
  gl.vertexAttribPointer(line.position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(line.viewport, viewport[0], viewport[1]);
  gl.uniform4fv(line.ink, ink);
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
}

/**
 * Paints a monochrome scene.
 *
 * The scene is the one the SVG export serialises, so the screen and the sheet
 * are the same map described once.
 */
export function drawMonochromeSceneWebGl(state, scene) {
  const { gl } = state;
  const viewport = [scene.widthPx, scene.heightPx];
  const ink = parseCssColour(scene.ink);
  const paper = parseCssColour(scene.paper);
  const transform = scene.transform;

  gl.viewport(0, 0, scene.widthPx, scene.heightPx);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(paper[0], paper[1], paper[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // The sea's ruling, then the zones, then the linework over both.
  const basemap = scene.basemap ?? {};
  if (scene.waterPattern && basemap.waterFeatures?.length) {
    fillWaterThroughStencil(state, scene, viewport);
  }

  // Clipped to the land. A zone is a claim about ground someone can stand on,
  // and water is not that - the sea and the lakes alike.
  const clipTo = scene.basemap.clipFeatures ?? [];
  const clipped = clipTo.length > 0
    && maskRingsIntoStencil(state, scene, viewport, clipTo);
  if (clipped) {
    gl.stencilFunc(gl.NOTEQUAL, 1, 1);
  }
  const drawnSegments = drawRibbons(state, scene, viewport, ink, paper);
  if (clipped) {
    gl.disable(gl.STENCIL_TEST);
  }

  // The linework goes over the zones, not under them. A zone is opaque paper
  // where its hatch is not inked, so anything drawn first is covered - and a
  // reader needs the coast and the streets to place the isochrone against.
  if (scene.waterPattern && basemap.waterFeatures?.length) {
    const outline = [];
    for (const feature of basemap.waterFeatures) {
      for (const path of feature.paths) {
        appendThickPolyline(
          outline, Float64Array.from(path.flat()), transform, scene.contourStrokeWidth, true,
        );
      }
    }
    drawTriangles(state, Float32Array.from(outline), ink, viewport);
  }

  // The district edges, over the zones with the rest of the linework. They are
  // what says which city this is.
  if (basemap.districtFeatures?.length) {
    const districts = [];
    for (const feature of basemap.districtFeatures) {
      for (const path of feature.paths) {
        appendThickPolyline(
          districts,
          Float64Array.from(path.flat()),
          transform,
          Math.max(1, scene.districtStrokeWidth ?? 0.6),
          true,
        );
      }
    }
    drawTriangles(state, Float32Array.from(districts), ink, viewport);
  }

  if (state.stroke && basemap.allRoadSegments) {
    drawInstancedStrokes(
      state,
      basemap.allRoadSegments,
      scene.frame,
      Math.max(1, scene.roadStrokeWidth),
      parseCssColour(scene.roadInk ?? scene.ink),
      viewport,
    );
  }



  drawSceneLabels(state, scene, viewport, ink, paper);
  return drawnSegments;
}

/**
 * Fills the sea with its ruling, holes and all.
 *
 * A coastline is one polygon per feature: an outer ring with each island taken
 * out of it. Nothing on the GPU fills that directly, so the rings are drawn as
 * fans into the stencil buffer with INVERT - which leaves exactly an even-odd
 * mask, islands excluded - and the hatch is painted through it by a single
 * quad covering the view.
 */
/**
 * An even-odd mask of the given rings, in the stencil buffer.
 *
 * Fans drawn with INVERT leave exactly the inside of a polygon with holes, so
 * a coastline masks the sea and an island inside it comes back out. Returns
 * whether there was anything to mask; the test is left enabled and the caller
 * decides which side of it to draw on.
 */
function maskRingsIntoStencil(state, scene, viewport, features) {
  const { gl } = state;
  const fans = [];
  for (const feature of features) {
    for (const path of feature.paths) {
      if (path.length < 3) {
        continue;
      }
      const [originX, originY] = scene.transform(path[0][0], path[0][1]);
      for (let index = 1; index + 1 < path.length; index += 1) {
        const [x1, y1] = scene.transform(path[index][0], path[index][1]);
        const [x2, y2] = scene.transform(path[index + 1][0], path[index + 1][1]);
        fans.push(originX, originY, x1, y1, x2, y2);
      }
    }
  }
  if (fans.length < 6) {
    return false;
  }
  gl.enable(gl.STENCIL_TEST);
  gl.clearStencil(0);
  gl.clear(gl.STENCIL_BUFFER_BIT);
  gl.colorMask(false, false, false, false);
  gl.stencilFunc(gl.ALWAYS, 0, 1);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
  drawTriangles(state, Float32Array.from(fans), [0, 0, 0, 1], viewport);
  gl.colorMask(true, true, true, true);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  return true;
}

function fillWaterThroughStencil(state, scene, viewport) {
  const { gl, fill } = state;
  const tile = getOrCreateTileTexture(state, scene.waterPattern, scene.patternScale, scene.waterInk ?? scene.ink);
  if (!tile) {
    return;
  }
  if (!maskRingsIntoStencil(state, scene, viewport, scene.basemap.waterFeatures)) {
    return;
  }
  gl.stencilFunc(gl.EQUAL, 1, 1);
  const quad = Float32Array.of(
    0, 0, viewport[0], 0, viewport[0], viewport[1],
    0, 0, viewport[0], viewport[1], 0, viewport[1],
  );
  gl.useProgram(fill.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(fill.position);
  gl.vertexAttribPointer(fill.position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(fill.viewport, viewport[0], viewport[1]);
  gl.uniform2f(fill.tileSize, tile.sizePx, tile.sizePx);
  gl.uniform4fv(fill.ink, parseCssColour(scene.waterInk ?? scene.ink));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tile.texture);
  gl.uniform1i(fill.tile, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.disable(gl.STENCIL_TEST);
}

function drawSceneLabels(state, scene, viewport, ink, paper) {
  const labels = scene.labels ?? [];
  if (labels.length === 0) {
    return;
  }
  const atlas = getOrCreateGlyphAtlas(state, scene.labelFontSize);
  if (!atlas) {
    return;
  }
  const { gl, glyph } = state;

  // The halo first, as eight offset copies of every glyph, then the ink over
  // it. Black text on a black hatch cannot be read however well it is placed,
  // and the offsets merge into a continuous mask because every halo pass
  // precedes every fill.
  const haloRadius = Math.max(1, scene.labelFontSize * 0.18);
  const halo = [];
  for (const [dx, dy] of HALO_OFFSETS) {
    for (const label of labels) {
      appendLabelQuads(halo, label, atlas, [dx * haloRadius, dy * haloRadius]);
    }
  }
  const fill = [];
  for (const label of labels) {
    appendLabelQuads(fill, label, atlas);
  }

  gl.useProgram(glyph.program);
  gl.uniform2f(glyph.viewport, viewport[0], viewport[1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
  gl.uniform1i(glyph.atlas, 0);
  for (const [vertices, colour] of [[halo, paper], [fill, ink]]) {
    if (vertices.length === 0) {
      continue;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, state.glyphBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(vertices), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(glyph.position);
    gl.vertexAttribPointer(glyph.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(glyph.uv);
    gl.vertexAttribPointer(glyph.uv, 2, gl.FLOAT, false, 16, 8);
    gl.uniform4fv(glyph.ink, colour);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4);
  }
}
