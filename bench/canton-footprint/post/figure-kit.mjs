// Builds the post's figures. A picture is one drawing. An animated figure is a
// list of layers painted in order. A layer with `states` fades between
// opacities at fixed seconds of a loop, so the figure plays as plain CSS
// keyframes inside one SVG file.
//
// A loop has cases of equal length. A part stays until the part that replaces
// it fades in, so no place in a figure is empty between two cases.
import assert from "node:assert/strict";

export const CANVAS_WIDTH = 1200;
export const MARGIN = 60;
export const CASE_SECONDS = 6.5;
export const FADE_SECONDS = 0.5;
export const DIMMED_OPACITY = 0.22;

// Seconds from the start of a case. Changes land about a second apart.
export const BEAT = {
  first: 1.2,
  second: 2.3,
  third: 3.1,
  verdict: 3.7,
};

export const COLOR = {
  page: "#0E1A1C",
  ink: "#FFFFFF",
  quiet: "#B3B3B3",
  line: "#556062",
  faint: "#414D4F",
  test: "#40FB50",
  limit: "#FFD66E",
  reject: "#DE4747",
};

const FONT_STACK =
  "'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const MONO_ADVANCE_EM = 0.6;
const SQUARE_PX = 10;
const SQUARE_SPEED_PX_PER_SECOND = 110;
const SQUARE_GAP_SECONDS = 1.2;
const SQUARE_OVERSHOOT_PX = 16;
const VERDICT_HEIGHT = 56;
const VERDICT_COLOR = {
  plain: COLOR.ink,
  good: COLOR.test,
  bad: COLOR.reject,
};

export function secondsAt({ caseIndex, beat }) {
  return caseIndex * CASE_SECONDS + beat;
}

/**
 * The second at which the change into a case starts. The change ends when the
 * case starts, so the first case is complete when the loop starts.
 */
export function caseEntry({ caseIndex, caseCount }) {
  const loopSeconds = caseCount * CASE_SECONDS;
  return (caseIndex * CASE_SECONDS - FADE_SECONDS + loopSeconds) % loopSeconds;
}

/**
 * A layer that is hidden except between each `[from, to]` pair of seconds. A
 * pair whose `to` is before its `from` runs through the end of the loop.
 */
export function shownDuring(intervals) {
  const states = [];
  for (const [from, to] of intervals) {
    states.push({ at: from, opacity: 1 }, { at: to, opacity: 0 });
  }
  return states.sort((first, second) => first.at - second.at);
}

export function escapeXml(content) {
  return content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function textWidth({ content, size, spacingEm }) {
  return content.length * size * (MONO_ADVANCE_EM + spacingEm);
}

/**
 * One line of text. SVG does not wrap, so `fitWidth` is the room the caller
 * has, and a line that needs more fails the build.
 */
export function text({
  x,
  y,
  content,
  size,
  fitWidth,
  color = COLOR.ink,
  weight = "normal",
  anchor = "start",
  spacingEm = 0,
}) {
  const needed = textWidth({ content, size, spacingEm });
  assert.ok(
    needed <= fitWidth,
    `"${content}" needs ${Math.ceil(needed)} px and has ${fitWidth} px`,
  );
  return (
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" ` +
    `letter-spacing="${spacingEm}em" text-anchor="${anchor}" fill="${color}">` +
    `${escapeXml(content)}</text>`
  );
}

/** A node: a solid frame, a dashed inner frame, and a centred title. */
export function nodeBox({ x, y, width, height, title, stroke = COLOR.ink }) {
  const inset = 8;
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${COLOR.page}" stroke="${stroke}" stroke-width="2"/>` +
    `<rect x="${x + inset}" y="${y + inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" stroke="${COLOR.faint}" stroke-width="2" stroke-dasharray="8 8"/>` +
    text({
      x: x + width / 2,
      y: y + 38,
      content: title,
      size: 18,
      weight: "bold",
      anchor: "middle",
      spacingEm: 0.04,
      fitWidth: width - 4 * inset,
    })
  );
}

/** The second, quieter line of a node box. */
export function nodeNote({ box, content, color = COLOR.quiet }) {
  return text({
    x: box.x + box.width / 2,
    y: box.y + 62,
    content,
    size: 16,
    color,
    anchor: "middle",
    fitWidth: box.width - 32,
  });
}

function pathData(points) {
  const [first, ...rest] = points;
  let data = `M${first[0]} ${first[1]}`;
  for (const [x, y] of rest) {
    data += `L${x} ${y}`;
  }
  return data;
}

function pathLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [fromX, fromY] = points[index - 1];
    const [toX, toY] = points[index];
    length += Math.hypot(toX - fromX, toY - fromY);
  }
  return length;
}

// Moves `point` away from `neighbour` so that a square starts and ends under
// the boxes at both ends of a link.
function pushedAway({ point, neighbour }) {
  const [x, y] = point;
  const distance = Math.hypot(x - neighbour[0], y - neighbour[1]);
  const scale = SQUARE_OVERSHOOT_PX / distance;
  return [x + (x - neighbour[0]) * scale, y + (y - neighbour[1]) * scale];
}

/** A link nothing travels on. */
export function idleLink({ points }) {
  return `<path d="${pathData(points)}" stroke="${COLOR.line}" stroke-width="2"/>`;
}

/** A live link: a solid line with squares that travel from its first point to its last. */
export function flowLink({ points, color }) {
  assert.ok(points.length >= 2, "a link needs two points");
  const motionPoints = [
    pushedAway({ point: points[0], neighbour: points[1] }),
    ...points.slice(1, -1),
    pushedAway({ point: points.at(-1), neighbour: points.at(-2) }),
  ];
  const travelSeconds = pathLength(motionPoints) / SQUARE_SPEED_PX_PER_SECOND;
  const squareCount = Math.max(
    2,
    Math.ceil(travelSeconds / SQUARE_GAP_SECONDS),
  );
  const periodSeconds = squareCount * SQUARE_GAP_SECONDS;
  const travelShare = (travelSeconds / periodSeconds).toFixed(4);
  const half = SQUARE_PX / 2;
  let squares = "";
  for (let index = 0; index < squareCount; index += 1) {
    const begin = (-index * SQUARE_GAP_SECONDS).toFixed(3);
    squares +=
      `<rect x="${-half}" y="${-half}" width="${SQUARE_PX}" height="${SQUARE_PX}" fill="${color}">` +
      `<animateMotion dur="${periodSeconds.toFixed(3)}s" begin="${begin}s" repeatCount="indefinite" calcMode="linear" ` +
      `keyPoints="0;1;1" keyTimes="0;${travelShare};1" path="${pathData(motionPoints)}"/></rect>`;
  }
  return (
    `<path d="${pathData(points)}" stroke="${color}" stroke-width="2"/>` +
    `<g class="tr">${squares}</g>`
  );
}

/** A link that refuses traffic: dashed, with a crossed box at `cross`. */
export function brokenLink({ points, cross }) {
  const [x, y] = cross;
  return (
    `<path d="${pathData(points)}" stroke="${COLOR.line}" stroke-width="2" stroke-dasharray="8 6"/>` +
    `<rect x="${x - 15}" y="${y - 15}" width="30" height="30" fill="${COLOR.page}" stroke="${COLOR.reject}" stroke-width="2"/>` +
    `<path d="M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x - 6} ${y + 6}L${x + 6} ${y - 6}" stroke="${COLOR.reject}" stroke-width="2"/>`
  );
}

/** The boxed outcome at the foot of a figure. */
export function verdict({ y, width, content, tone }) {
  const color = VERDICT_COLOR[tone];
  assert.ok(color, `unknown verdict tone: ${tone}`);
  const x = (CANVAS_WIDTH - width) / 2;
  let frame = `<rect x="${x}" y="${y}" width="${width}" height="${VERDICT_HEIGHT}" fill="${COLOR.page}" stroke="${color}" stroke-width="2"/>`;
  if (tone !== "plain") {
    frame += `<rect x="${x}" y="${y}" width="${width}" height="${VERDICT_HEIGHT}" fill="${color}" fill-opacity="0.16"/>`;
  }
  return (
    frame +
    text({
      x: CANVAS_WIDTH / 2,
      y: y + 36,
      content,
      size: 20,
      color,
      weight: "bold",
      anchor: "middle",
      spacingEm: 0.04,
      fitWidth: width - 40,
    })
  );
}

/** The two lines at the head of a figure: a small label and one statement. */
export function heading({ kicker, statement }) {
  const fitWidth = CANVAS_WIDTH - 2 * MARGIN;
  return (
    text({
      x: MARGIN,
      y: 52,
      content: kicker,
      size: 17,
      color: COLOR.quiet,
      weight: "bold",
      spacingEm: 0.08,
      fitWidth,
    }) + text({ x: MARGIN, y: 94, content: statement, size: 26, fitWidth })
  );
}

/**
 * The heading that says where the loop is and what the case shows. `kind` is
 * the word for one part of the loop, such as STEP or CASE.
 */
export function captionLayers({ kind, statements }) {
  const caseCount = statements.length;
  const layers = [];
  for (const [caseIndex, statement] of statements.entries()) {
    const kicker = `${kind} ${caseIndex + 1} OF ${caseCount}`;
    layers.push({
      markup: heading({ kicker, statement }),
      states: shownDuring([
        [
          caseEntry({ caseIndex, caseCount }),
          caseEntry({ caseIndex: (caseIndex + 1) % caseCount, caseCount }),
        ],
      ]),
    });
  }
  return layers;
}

function assertStatesFit({ states, loopSeconds }) {
  let free = 0;
  for (const state of states) {
    assert.ok(
      state.at >= free,
      `a fade starts at ${state.at} s before the previous one ends`,
    );
    free = state.at + FADE_SECONDS;
  }
  assert.ok(free <= loopSeconds, `a fade ends after the ${loopSeconds} s loop`);
}

// The opacity a layer carries into a loop is the one its last state left.
function opacityAt({ states, second }) {
  let opacity = states.at(-1).opacity;
  for (const state of states) {
    if (second < state.at) {
      break;
    }
    const progress = Math.min(1, (second - state.at) / FADE_SECONDS);
    opacity += (state.opacity - opacity) * progress;
  }
  return opacity;
}

function keyframeStops({ states, loopSeconds }) {
  const percent = (second) => `${((second / loopSeconds) * 100).toFixed(3)}%`;
  let opacity = states.at(-1).opacity;
  let stops = `0%{opacity:${opacity}}`;
  for (const state of states) {
    stops += ` ${percent(state.at)}{opacity:${opacity}}`;
    stops += ` ${percent(state.at + FADE_SECONDS)}{opacity:${state.opacity}}`;
    opacity = state.opacity;
  }
  return `${stops} 100%{opacity:${opacity}}`;
}

function documentMarkup({ figure, style, body }) {
  const { height, title, description } = figure;
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${height}" viewBox="0 0 ${CANVAS_WIDTH} ${height}" fill="none" font-family="${FONT_STACK}" role="img" aria-labelledby="figure-title figure-description">\n` +
    `<title id="figure-title">${escapeXml(title)}</title>\n` +
    `<desc id="figure-description">${escapeXml(description)}</desc>\n` +
    `${style}<rect width="${CANVAS_WIDTH}" height="${height}" fill="${COLOR.page}"/>\n` +
    `${body}</svg>\n`
  );
}

/** A figure with no clock: one drawing. */
export function renderPicture(figure) {
  return documentMarkup({
    figure,
    style: "",
    body: `<g>${figure.markup}</g>\n`,
  });
}

/**
 * The looping figure. With reduced motion it shows the frame at
 * `figure.posterSeconds` and hides the travelling squares.
 */
export function renderAnimated(figure) {
  const { loopSeconds, posterSeconds, layers } = figure;
  let rules = "";
  let body = "";
  let animatedCount = 0;
  for (const layer of layers) {
    if (!layer.states) {
      body += `<g>${layer.markup}</g>\n`;
      continue;
    }
    assertStatesFit({ states: layer.states, loopSeconds });
    const name = `k${animatedCount}`;
    animatedCount += 1;
    rules += `@keyframes ${name}{${keyframeStops({ states: layer.states, loopSeconds })}}\n`;
    rules += `.${name}{animation:${name} ${loopSeconds}s ease-in-out infinite}\n`;
    const poster = opacityAt({ states: layer.states, second: posterSeconds });
    body += `<g class="${name}" opacity="${poster.toFixed(2)}">${layer.markup}</g>\n`;
  }
  const style =
    `<style>\n${rules}` +
    `@media (prefers-reduced-motion: reduce){*{animation:none !important}.tr{display:none}}\n</style>\n`;
  return documentMarkup({ figure, style, body });
}

/** One frozen frame of the figure, for a look at a single beat. */
export function renderStill({ figure, second }) {
  let body = "";
  for (const layer of figure.layers) {
    let opacity = 1;
    if (layer.states) {
      opacity = opacityAt({ states: layer.states, second });
    }
    body += `<g opacity="${opacity.toFixed(2)}">${layer.markup}</g>\n`;
  }
  const style = "<style>.tr{display:none}</style>\n";
  return documentMarkup({ figure, style, body });
}
