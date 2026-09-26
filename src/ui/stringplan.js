/**
 * String plan: side view of the whole bow with the limbs, both cams, the
 * string and both power cables, at brace and full draw (outlined) and at
 * the draw position (solid), with the load on the limb tip as an arrow.
 * The lengths are listed under the drawing.
 *
 * With changed cords in the Timing settings (core/timinglayout) the plan
 * shows the changed bow instead: each half from the analysis, the outlines
 * at its brace and at the end of its draw (the first stop), the nock off
 * the axis. The cam and the listed lengths stay those of the design.
 *
 * World frame as in core/geometry (origin at the grip pivot point, x
 * towards the archer, y up); the SVG user space flips y. The bottom half is
 * the top half under scale(1, −1); with changed cords it is drawn from its
 * own pose, in its mirror frame under scale(1, −1).
 * @module ui/stringplan
 */

import { fromSI } from '../core/units.js';
import { bowPoseAt, createBowPose } from '../core/layout.js';
import { buildLengths } from '../core/cords.js';
import { createTimingLayout, timingPoseAt } from '../core/timinglayout.js';
import { pathOf } from './camview.js';
import { DEGREE, dimsText, drawText, fixed, forceText } from './display.js';
import { h, setAttrs, svg } from './dom.js';
import { FIT_PADDING, KEYS_HELP, coord, createViewport, viewBoxFor } from './viewport.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/layout.js').LayoutContext} LayoutContext */
/** @typedef {import('../core/layout.js').BowPose} BowPose */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('./viewport.js').Bounds} Bounds */
/** @typedef {import('../core/timinglayout.js').TimingLayout} TimingLayout */
/** @typedef {import('../core/timinglayout.js').TimingPose} TimingPose */
/** @typedef {import('../core/timinglayout.js').HalfPose} HalfPose */

/**
 * One half as the plan draws it, in its own frame: a BowPose, or a half of
 * the changed bow with the nock at height nockY.
 * @typedef {object} PlanPose
 * @property {number} x nock position (m)
 * @property {number} [nockY] nock height in the frame of the half (m), 0 when absent
 * @property {number} pivotX
 * @property {number} pivotY
 * @property {number} axleX
 * @property {number} axleY
 * @property {number} theta
 * @property {number} stringX
 * @property {number} stringY
 * @property {number} cableX
 * @property {number} cableY
 * @property {number} anchorX
 * @property {number} anchorY
 */

/** Caption over a stale plan. */
export const STALE_CAPTION = 'Bow of the last cam that met every check';
/** Caption over the plan while newer inputs are being solved. */
export const OUTDATED_CAPTION = 'Bow of the previous inputs; solving the current inputs';

/** Caption of the changed bow of the Timing settings. */
export const TIMING_CAPTION = 'Bow with the timing settings; the cam and the lengths listed are those of the design';

/** Sentence added to a stale caption while the current inputs are being solved. */
export const SOLVING_SUFFIX = '; solving the current inputs';

/**
 * Accessible name of the string plan. It names the full-draw outline only
 * when the solve reached full draw, as the drawing does.
 * @param {number} ataBrace axle-to-axle length at brace (m), NaN when unknown
 * @param {boolean} hasFull the solve reached full draw
 * @param {boolean} stale the plan shows the last cam that met every check
 * @param {Units} units
 * @param {boolean} [timing] the plan shows the changed bow of the Timing settings
 */
export function planLabel(ataBrace, hasFull, stale, units, timing = false) {
  const ata = Number.isFinite(ataBrace) ? `, axle-to-axle ${dimsText(ataBrace, units)} at brace` : '';
  const outlines = timing
    ? 'outlines at brace and at the end of the draw'
    : hasFull ? 'outlines at brace and full draw' : 'outline at brace; full draw not solved';
  const halves = timing ? 'top and bottom with the timing settings' : 'top and bottom symmetric';
  return `String plan, side view of the bow, ${halves}${ata}; ${outlines}, `
    + `solid at the draw position; ${KEYS_HELP}${stale ? '; last cam that met every check' : ''}`;
}

/**
 * Caption of a plan or loads view, or '' for none. A stale view shows the
 * last cam that met every check, also while a newer solve runs; an outdated
 * view shows the previous inputs.
 * @param {boolean} stale the result shown is the last one that met every check
 * @param {boolean} outdated a newer solve has run for PENDING_DELAY or longer
 * @param {string} staleText
 * @param {string} outdatedText
 */
export function ageCaption(stale, outdated, staleText, outdatedText) {
  if (stale) return outdated ? `${staleText}${SOLVING_SUFFIX}` : staleText;
  return outdated ? outdatedText : '';
}
/** Length of the arrow of the largest limb tip load, as a fraction of the view. */
const ARROW = 0.12;

let planCount = 0;

/**
 * Largest distance of the cam outlines from the axle (m).
 * @param {SolveResult} result
 */
export function camRadius(result) {
  let r = 0;
  for (const o of Object.values(result.outlines)) {
    if (!o) continue;
    for (let i = 0; i < o.x.length; i++) {
      const d = Math.hypot(o.x[i], o.y[i]);
      if (d > r) r = d;
    }
  }
  return r;
}

/**
 * Bounds of the plan: the riser, both axles, the nock and the cams at
 * brace and at full draw, and the grip. A half in its mirror frame counts
 * for both halves.
 * @param {PlanPose[]} poses
 * @param {number} radius cam radius (m)
 * @returns {Bounds}
 */
export function planBounds(poses, radius) {
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} [r]
   */
  const add = (x, y, r = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r, -y - r);
    maxY = Math.max(maxY, y + r, -y + r);
  };
  for (const p of poses) {
    add(p.pivotX, p.pivotY);
    add(p.axleX, p.axleY, radius);
    add(p.x, p.nockY ?? 0);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Direction of the limb tip load as text: the angle from the vertical line
 * from the axle towards the grip, and to which side it leans.
 * @param {number} tipX (N)
 * @param {number} tipY (N)
 */
export function loadDirection(tipX, tipY) {
  if (!Number.isFinite(tipX) || !Number.isFinite(tipY) || (tipX === 0 && tipY === 0)) return '';
  const deg = (Math.atan2(Math.abs(tipX), -tipY) * 180) / Math.PI;
  if (deg < 0.05) return 'along the vertical from the axle towards the grip';
  return `${fixed(deg, 1)}${DEGREE} off the vertical from the axle towards the grip, leaning towards the ${tipX > 0 ? 'archer' : 'target'}`;
}

/**
 * Fill the full-draw pose; false when the solve stopped before full draw,
 * so no full-draw pose exists.
 * @param {LayoutContext} ctx
 * @param {BowPose} pose
 */
export function fullDrawPose(ctx, pose) {
  return bowPoseAt(ctx, ctx.xFull, pose) && !pose.beyondSolution;
}

/**
 * Poses the plan fits and outlines: brace, and full draw when solved, else
 * the last solved pose, which the draw position can still show.
 * @param {LayoutContext} ctx
 * @returns {{ brace: BowPose, end: BowPose, hasFull: boolean }}
 */
export function planPoses(ctx) {
  const brace = createBowPose();
  const end = createBowPose();
  bowPoseAt(ctx, ctx.xBrace, brace);
  const hasFull = fullDrawPose(ctx, end);
  if (!hasFull) bowPoseAt(ctx, ctx.xLast, end);
  return { brace, end, hasFull };
}

/**
 * The two halves of the changed bow as the plan draws them.
 * @param {TimingPose} tp
 * @returns {[PlanPose, PlanPose]}
 */
export function timingHalves(tp) {
  /** @param {HalfPose} hp */
  const plan = (hp) => ({
    x: tp.x, nockY: hp.nockY, pivotX: tp.pivotX, pivotY: tp.pivotY, axleX: hp.axleX, axleY: hp.axleY, theta: hp.theta,
    stringX: hp.stringX, stringY: hp.stringY, cableX: hp.cableX, cableY: hp.cableY, anchorX: hp.anchorX, anchorY: hp.anchorY,
  });
  return [plan(tp.top), plan(tp.bottom)];
}

/**
 * Draw position of the changed bow for a draw position of the design: the
 * same fraction of the draw, from brace to full draw of the design onto
 * brace to the end of the draw of the changed bow, so the draw-position
 * control reaches both ends of the changed draw.
 * @param {LayoutContext} ctx
 * @param {TimingLayout} tl
 * @param {number} x draw position of the design (m)
 */
export function timingX(ctx, tl, x) {
  const span = ctx.xFull - ctx.xBrace;
  const u = span > 0 ? Math.min(1, Math.max(0, (x - ctx.xBrace) / span)) : 0;
  return tl.xBrace + u * (tl.xEnd - tl.xBrace);
}

/**
 * Text under the plan of the changed bow at a draw position: draw length,
 * nock height and cam timing, positive with the top cam ahead.
 * @param {TimingPose} tp
 * @param {Units} units
 */
export function timingPoseText(tp, units) {
  const dTheta = ((tp.top.theta - tp.bottom.theta) * 180) / Math.PI;
  const t = Math.abs(dTheta) < 0.005 ? `0.00${DEGREE}` : `${dTheta > 0 ? '+' : '−'}${fixed(Math.abs(dTheta), 2)}${DEGREE}`;
  const decimals = units.dims === 'mm' ? 2 : 3;
  const v = fromSI(tp.y, 'length', units.dims);
  const y = `${Math.abs(v) < 0.5 * 10 ** -decimals ? '' : v > 0 ? '+' : '−'}${fixed(Math.abs(v), decimals)} ${units.dims}`;
  return `Timing settings at draw ${drawText(tp.x, units)} ${units.draw}: nock height ${y}, cam timing ${t}`;
}

/**
 * Lengths listed under the plan: label, test id and text. With a layout of
 * the changed bow, the brace height and the end of its draw follow; with
 * elastic cords, the free length of each cord and its length at 445 N
 * (100 lbf) follow the pitch-line lengths.
 * @param {LayoutContext} ctx
 * @param {Units} units
 * @param {TimingLayout | null} [tl]
 * @param {import('../core/cords.js').CordStiffness | null} [stiffness] EA of each cord, null for rigid cords
 * @returns {{ label: string, key: string, text: string }[]}
 */
export function planDims(ctx, units, tl = null, stiffness = null) {
  /** @param {number} v */
  const both = (v) => {
    if (!Number.isFinite(v)) return '—';
    const other = units.dims === 'mm' ? 'in' : 'mm';
    return `${dimsText(v, units)} (${dimsText(v, { ...units, dims: other })})`;
  };
  /** @param {number} v */
  const one = (v) => (Number.isFinite(v) ? dimsText(v, units) : '—');
  /** @type {{ label: string, key: string, text: string }[]} */
  const stretch = [];
  const Ts = ctx.loads.Ts[0];
  const Tc = ctx.loads.Tc[0];
  if (stiffness && Number.isFinite(Ts) && Number.isFinite(Tc)) {
    const b = buildLengths(ctx.lengths, { string: Ts, cable: Tc }, stiffness);
    // core/cords BUILD_TENSION: 100 lbf, 444.8 N.
    const load = units.force === 'lbf' ? '100 lbf (445 N)' : '445 N (100 lbf)';
    for (const [label, key, c] of /** @type {const} */ ([['String', 'string', b.string], ['Top cable', 'top-cable', b.topCable], ['Bottom cable', 'bottom-cable', b.bottomCable]])) {
      stretch.push(
        { label: `${label}, free length`, key: `${key}-free`, text: both(c.free) },
        { label: `${label} at ${load}`, key: `${key}-loaded`, text: both(c.loaded) },
      );
    }
  }
  return [
    { label: 'String, pitch line', key: 'string', text: both(ctx.lengths.string) },
    { label: 'Power cable, pitch line, each of 2', key: 'cable', text: both(ctx.lengths.cable) },
    ...stretch,
    { label: 'Axle-to-axle at brace', key: 'ataBrace', text: one(ctx.lengths.ataBrace) },
    {
      label: 'Axle-to-axle at full draw',
      key: 'ataFull',
      text: Number.isFinite(ctx.lengths.ataFull) ? one(ctx.lengths.ataFull) : 'not solved to full draw',
    },
    { label: 'Brace height', key: 'brace', text: `${fixed(fromSI(ctx.xBrace, 'length', units.draw), 2)} ${units.draw}` },
    { label: 'Draw length (AMO)', key: 'draw', text: `${drawText(ctx.xFull, units)} ${units.draw}` },
    ...(tl
      ? [
          { label: 'Brace height, timing settings', key: 'timing-brace', text: `${fixed(fromSI(tl.xBrace, 'length', units.draw), 2)} ${units.draw}` },
          { label: 'End of the draw (AMO), timing settings', key: 'timing-end', text: `${drawText(tl.xEnd, units)} ${units.draw}` },
        ]
      : []),
  ];
}

/**
 * @typedef {object} PoseGroup
 * @property {SVGGElement} group top half, with an id for the mirrored copy
 * @property {SVGUseElement} mirror bottom half
 * @property {SVGLineElement} limb
 * @property {SVGGElement} cam
 * @property {SVGPathElement} stringTrack
 * @property {SVGPathElement} cableTrack
 * @property {SVGLineElement} string
 * @property {SVGLineElement} cable
 * @property {SVGCircleElement} axle
 * @property {SVGCircleElement} nock
 */

/**
 * @param {string} id
 * @param {string} cls
 * @returns {PoseGroup}
 */
function poseGroup(id, cls) {
  const group = svg('g', { id, class: `plan-pose ${cls}` });
  /** @param {string} c */
  const line = (c) => svg('line', { class: c, 'vector-effect': 'non-scaling-stroke' });
  const limb = line('plan-limb');
  const cam = svg('g', { class: 'plan-cam' });
  const stringTrack = svg('path', { class: 'plan-track plan-string', fill: 'none', 'vector-effect': 'non-scaling-stroke' });
  const cableTrack = svg('path', { class: 'plan-track plan-cable', fill: 'none', 'vector-effect': 'non-scaling-stroke' });
  cam.append(cableTrack, stringTrack);
  const string = line('plan-cord plan-string');
  const cable = line('plan-cord plan-cable');
  const axle = svg('circle', { class: 'plan-axle', 'vector-effect': 'non-scaling-stroke' });
  const nock = svg('circle', { class: 'plan-nock', 'vector-effect': 'non-scaling-stroke' });
  group.append(limb, cam, cable, string, axle, nock);
  const mirror = svg('use', { href: `#${id}`, transform: 'scale(1,-1)', class: `plan-pose ${cls}` });
  return { group, mirror, limb, cam, stringTrack, cableTrack, string, cable, axle, nock };
}

/**
 * A pose group of the bottom half with its own pose, in its mirror frame.
 * @param {string} cls
 * @returns {PoseGroup & { flip: SVGGElement }}
 */
function bottomGroup(cls) {
  const g = poseGroup('', cls);
  g.group.removeAttribute('id');
  const flip = svg('g', { transform: 'scale(1,-1)', class: 'plan-bottom' });
  flip.append(g.group);
  return { ...g, flip };
}

/**
 * @param {PoseGroup} g
 * @param {PlanPose} p
 * @param {number} r dot radius (m)
 */
function placePose(g, p, r) {
  const ny = coord(-(p.nockY ?? 0));
  setAttrs(g.limb, { x1: coord(p.pivotX), y1: coord(-p.pivotY), x2: coord(p.axleX), y2: coord(-p.axleY) });
  setAttrs(g.cam, { transform: `translate(${coord(p.axleX)} ${coord(-p.axleY)}) rotate(${coord((p.theta * 180) / Math.PI)})` });
  setAttrs(g.string, { x1: coord(p.stringX), y1: coord(-p.stringY), x2: coord(p.x), y2: ny });
  setAttrs(g.cable, { x1: coord(p.cableX), y1: coord(-p.cableY), x2: coord(p.anchorX), y2: coord(-p.anchorY) });
  setAttrs(g.axle, { cx: coord(p.axleX), cy: coord(-p.axleY), r });
  setAttrs(g.nock, { cx: coord(p.x), cy: ny, r });
}

/**
 * @typedef {object} StringPlan
 * @property {(result: SolveResult | null, ctx: LayoutContext | null, units: Units, stale: boolean, outdated?: boolean,
 *   stiffness?: import('../core/cords.js').CordStiffness | null) => void} render
 *   draw the bow of a result: stale when it is the last cam that met every
 *   check, outdated while newer inputs are being solved; stiffness: EA of
 *   the cords of its inputs for the build lengths, null for rigid cords;
 *   the same arguments again do nothing
 * @property {(pose: BowPose | null, units: Units) => void} setPose move the solid pose
 * @property {() => void} destroy remove the elements and with them their listeners
 */

/**
 * Build the string plan inside a container.
 * @param {HTMLElement} container
 * @returns {StringPlan}
 */
export function createStringPlan(container) {
  const n = ++planCount;
  const dimsId = `plan-dims-${n}`;
  const root = svg('svg', {
    class: 'cam-view plan-view',
    'data-testid': 'string-plan',
    role: 'img',
    tabindex: 0,
    'aria-label': 'String plan: solving',
    'aria-describedby': dimsId,
    preserveAspectRatio: 'xMidYMid meet',
  });
  const statics = svg('g', { class: 'plan-static', 'aria-hidden': 'true' });
  const riser = svg('line', { class: 'plan-riser', 'vector-effect': 'non-scaling-stroke' });
  const axis = svg('line', { class: 'plan-axis', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '2 4' });
  const grip = svg('circle', { class: 'plan-grip', 'vector-effect': 'non-scaling-stroke' });
  statics.append(axis, riser, grip);
  const brace = poseGroup(`plan-${n}-brace`, 'plan-brace');
  const full = poseGroup(`plan-${n}-full`, 'plan-full');
  const current = poseGroup(`plan-${n}-current`, 'plan-current');
  current.group.setAttribute('data-testid', 'plan-current');
  const braceBottom = bottomGroup('plan-brace');
  const fullBottom = bottomGroup('plan-full');
  const currentBottom = bottomGroup('plan-current');
  currentBottom.group.setAttribute('data-testid', 'plan-current-bottom');
  const arrow = svg('path', { class: 'plan-load', 'data-testid': 'plan-load', fill: 'none', 'vector-effect': 'non-scaling-stroke' });
  const arrowMirror = svg('path', { class: 'plan-load', fill: 'none', 'vector-effect': 'non-scaling-stroke', transform: 'scale(1,-1)' });
  const drawing = svg('g', { class: 'cam-drawing plan-drawing' });
  drawing.append(
    statics, brace.group, brace.mirror, braceBottom.flip, full.group, full.mirror, fullBottom.flip,
    current.group, current.mirror, currentBottom.flip, arrow, arrowMirror,
  );
  root.append(drawing);
  drawing.style.display = 'none';
  const topCam = h('button', { type: 'button', class: 'camview-btn plan-top', 'data-testid': 'plan-top-cam' }, 'Top cam');
  const viewport = createViewport(root, { prefix: 'plan', label: 'String plan zoom', extra: [topCam] });

  const dims = h('dl', { class: 'plan-dims', id: dimsId, 'data-testid': 'plan-dims' });
  const load = h('p', { class: 'plan-load-text', 'data-testid': 'plan-load-text' });
  const legendItems = /** @type {const} */ ([
    ['plan-brace', 'At brace (dashed)'],
    ['plan-full', 'At full draw (dotted)'],
    ['plan-current', 'At the draw position'],
    ['plan-string', 'String'],
    ['plan-cable', 'Power cables'],
    ['plan-limb', 'Limb lever, pivot to axle'],
    ['plan-load', 'Load on the limb tip'],
  ]);
  const legend = h(
    'ul',
    { class: 'camview-legend', 'data-testid': 'plan-legend', 'aria-label': 'String plan legend' },
    ...legendItems.map(([cls, text]) => {
      const s = svg('svg', { class: 'camview-swatch', width: 24, height: 14, viewBox: '0 0 24 14', 'aria-hidden': 'true', focusable: 'false' });
      s.append(svg('line', { class: `plan-swatch ${cls}`, x1: 1, y1: 7, x2: 23, y2: 7 }));
      return h('li', { class: 'camview-legend-item', 'data-testid': `legend-${cls}` }, s, text);
    }),
  );
  // The full-draw row shows only while the full-draw outline does.
  const fullItem = /** @type {HTMLElement} */ (legend.querySelector('[data-testid="legend-plan-full"]'));
  fullItem.hidden = true;
  const fullText = /** @type {Text} */ (fullItem.lastChild);
  // The load arrow shows for the design bow only.
  const loadItem = /** @type {HTMLElement} */ (legend.querySelector('[data-testid="legend-plan-load"]'));
  const caption = h('p', { class: 'camview-caption', 'data-testid': 'plan-caption', 'aria-live': 'polite' });
  caption.hidden = true;
  container.append(viewport.controls, root, load, legend, dims, caption);

  /** @type {LayoutContext | null} */
  let ctx = null;
  let key = '';
  /** @type {SolveResult | null} */
  let shownResult = null;
  let radius = 0;
  let size = 1;
  /** @type {PlanPose | null} */
  let lastPose = null;
  /** @type {TimingLayout | null} */
  let tl = null;

  /** @param {boolean} on show the own bottom halves in place of the mirrors */
  const showTiming = (on) => {
    for (const g of [brace, full, current]) g.mirror.style.display = on ? 'none' : '';
    for (const g of [braceBottom, fullBottom, currentBottom]) g.flip.style.display = on ? '' : 'none';
  };
  showTiming(false);

  topCam.addEventListener('click', () => {
    const p = lastPose ?? null;
    if (!p || !Number.isFinite(p.axleX)) return;
    const s = Math.max(4 * radius, size / 8);
    viewport.show({ x: p.axleX - s / 2, y: -p.axleY - s / 2, size: s });
  });

  return {
    render(result, next, units, stale, outdated = false, stiffness = null) {
      const nextKey = `${units.dims}|${units.draw}|${units.force}|${stale}|${outdated}|${JSON.stringify(stiffness)}`;
      if (result === shownResult && next === ctx && nextKey === key) return;
      key = nextKey;
      ctx = next;
      shownResult = result;
      viewport.setUnit(units.dims);
      tl = result && next ? createTimingLayout(result, next) : null;
      const age = next ? ageCaption(stale, outdated, STALE_CAPTION, OUTDATED_CAPTION) : '';
      root.classList.toggle('cam-stale', age !== '');
      const text = [tl ? TIMING_CAPTION : '', age].filter(Boolean).join('. ');
      caption.textContent = text;
      caption.hidden = text === '';
      root.dataset.timing = tl ? 'changed' : '';
      if (!result || !next) {
        viewport.clear();
        drawing.style.display = 'none';
        dims.replaceChildren();
        load.textContent = '';
        fullItem.hidden = true;
        setAttrs(root, { 'aria-label': 'String plan: no cam yet' });
        return;
      }
      drawing.style.display = '';
      radius = camRadius(result);
      const design = planPoses(next);
      const tb = tl ? timingPoseAt(tl, tl.xBrace) : null;
      const te = tl ? timingPoseAt(tl, tl.xEnd) : null;
      const timing = tl !== null && tb !== null && te !== null;
      if (!timing) tl = null;
      /** @type {PlanPose[]} */
      const braces = timing ? timingHalves(/** @type {TimingPose} */ (tb)) : [design.brace];
      /** @type {PlanPose[]} */
      const ends = timing ? timingHalves(/** @type {TimingPose} */ (te)) : [design.end];
      const hasFull = timing || design.hasFull;
      showTiming(timing);
      full.group.style.display = hasFull ? '' : 'none';
      if (!timing) full.mirror.style.display = hasFull ? '' : 'none';
      fullItem.hidden = !hasFull;
      fullText.data = timing
        ? (tl?.analysis.stops.first ? 'At the first stop (dotted)' : 'At the end of the draw (dotted)')
        : 'At full draw (dotted)';
      loadItem.hidden = timing;
      const base = viewBoxFor(planBounds([...braces, ...ends], radius), FIT_PADDING);
      size = base.size;
      viewport.setBase(base);
      const stringD = result.outlines.stringPitch ? pathOf(result.outlines.stringPitch) : '';
      const cableD = result.outlines.cablePitch ? pathOf(result.outlines.cablePitch) : '';
      for (const g of [brace, full, current, braceBottom, fullBottom, currentBottom]) {
        setAttrs(g.stringTrack, { d: stringD || null });
        setAttrs(g.cableTrack, { d: cableD || null });
      }
      const r = 0.006 * size;
      placePose(brace, braces[0], r);
      if (hasFull) placePose(full, ends[0], r);
      if (timing) {
        placePose(braceBottom, braces[1], r);
        placePose(fullBottom, ends[1], r);
      }
      const b = braces[0];
      setAttrs(riser, { x1: coord(b.pivotX), y1: coord(-b.pivotY), x2: coord(b.pivotX), y2: coord(b.pivotY) });
      setAttrs(axis, { x1: 0, y1: 0, x2: coord(Math.max(next.xFull, tl ? tl.xEnd : 0)), y2: 0 });
      setAttrs(grip, { cx: 0, cy: 0, r: 1.5 * r });
      dims.replaceChildren(
        ...planDims(next, units, tl, stiffness).flatMap((d) => [h('dt', {}, d.label), h('dd', { 'data-testid': `plan-${d.key}` }, d.text)]),
      );
      setAttrs(root, { 'aria-label': planLabel(next.lengths.ataBrace, hasFull, stale, units, timing) });
    },
    setPose(pose, units) {
      lastPose = pose;
      const ok = ctx !== null && pose !== null && Number.isFinite(pose.theta);
      const tp = ok && tl && ctx ? timingPoseAt(tl, timingX(ctx, tl, /** @type {BowPose} */ (pose).x)) : null;
      current.group.style.display = ok ? '' : 'none';
      current.mirror.style.display = ok && !tl ? '' : 'none';
      currentBottom.flip.style.display = tp ? '' : 'none';
      arrow.style.display = ok && !tl ? '' : 'none';
      arrowMirror.style.display = ok && !tl ? '' : 'none';
      if (!ok || !ctx) {
        load.textContent = '';
        return;
      }
      if (tl) {
        // The changed bow at the same fraction of its draw; no load arrow.
        if (!tp) {
          current.group.style.display = 'none';
          load.textContent = '';
          return;
        }
        const [top, bottom] = timingHalves(tp);
        lastPose = top;
        placePose(current, top, 0.006 * size);
        placePose(currentBottom, bottom, 0.006 * size);
        const text = timingPoseText(tp, units);
        if (load.textContent !== text) load.textContent = text;
        return;
      }
      const p = /** @type {BowPose} */ (pose);
      placePose(current, p, 0.006 * size);
      // Arrow from the axle along the tip load, scaled to the largest load.
      const max = ctx.loads.maxAxle.value;
      const len = max > 0 ? (ARROW * size * p.axleLoad) / max : 0;
      const ux = p.axleLoad > 0 ? p.tipX / p.axleLoad : 0;
      const uy = p.axleLoad > 0 ? -p.tipY / p.axleLoad : 0;
      const x0 = p.axleX;
      const y0 = -p.axleY;
      const x1 = x0 + len * ux;
      const y1 = y0 + len * uy;
      const head = 0.2 * len;
      const hx = -ux * head;
      const hy = -uy * head;
      const d = len > 0
        ? `M ${coord(x0)} ${coord(y0)} L ${coord(x1)} ${coord(y1)} ` +
          `M ${coord(x1 + hx - 0.5 * hy)} ${coord(y1 + hy + 0.5 * hx)} L ${coord(x1)} ${coord(y1)} L ${coord(x1 + hx + 0.5 * hy)} ${coord(y1 + hy - 0.5 * hx)}`
        : '';
      setAttrs(arrow, { d: d || null });
      setAttrs(arrowMirror, { d: d || null });
      const dir = loadDirection(p.tipX, p.tipY);
      const text = Number.isFinite(p.axleLoad)
        ? `Load on each limb tip: ${forceText(p.axleLoad, units, true)} ${units.force}${dir ? `, ${dir}` : ''}`
        : '';
      if (load.textContent !== text) load.textContent = text;
    },
    destroy() {
      viewport.destroy();
      for (const el of [root, load, legend, dims, caption]) el.remove();
    },
  };
}
