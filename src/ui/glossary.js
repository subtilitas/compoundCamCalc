/**
 * Glossary terms and info buttons that show a one-sentence definition in a
 * popover. Uses the popover attribute where supported and a toggled
 * element otherwise; both work with mouse, touch and keyboard and close with
 * Escape or a click outside. A popover opens below its button, or above it
 * near the bottom of the window, and closes when the page scrolls or the
 * window is resized.
 * @module ui/glossary
 */

import { h } from './dom.js';

/** @type {Readonly<Record<string, { term: string, text: string }>>} */
export const GLOSSARY = Object.freeze({
  ata: {
    term: 'ATA',
    text: 'Axle-to-axle length (ATA): distance between the two cam axles of the braced bow.',
  },
  braceHeight: {
    term: 'brace height',
    text: 'Brace height: distance from the grip pivot point to the string of the braced bow at rest.',
  },
  drawLength: {
    term: 'draw length (AMO)',
    text: 'Draw length (AMO): distance from the nock point to the grip pivot point at full draw plus 1.75 in, as defined by the Archery Manufacturers Organization (AMO).',
  },
  peak: {
    term: 'peak draw force',
    text: 'Peak draw force: highest force on the draw force curve.',
  },
  letOff: {
    term: 'let-off',
    text: 'Let-off: drop from the peak draw force to the holding weight, as a percentage of the peak.',
  },
  hold: {
    term: 'holding weight',
    text: 'Holding weight: lowest draw force between the peak and full draw, the force the archer holds at full draw.',
  },
  valley: {
    term: 'valley',
    text: 'Valley: draw length range around the holding weight in which the force stays below the holding weight plus 5 % of the peak.',
  },
  powerStroke: {
    term: 'power stroke',
    text: 'Power stroke: distance the string travels from brace to full draw, equal to draw length minus 1.75 in minus brace height.',
  },
  energy: {
    term: 'draw energy',
    text: 'Draw energy: energy stored by drawing the bow, the area under the force curve from brace to full draw.',
  },
  limbEnergy: {
    term: 'limb energy',
    text: 'Limb energy: elastic energy stored in both limbs at full draw, counted from the unstrung limbs, so it includes the preload energy at brace.',
  },
  axleTravel: {
    term: 'axle travel',
    text: 'Axle travel: length of the arc the axle moves from brace to full draw, the limb lever length times the limb rotation at full draw.',
  },
  camRotation: {
    term: 'cam rotation',
    text: 'Cam rotation: angle the cam turns about its axle, counted from its position at brace. The results give the rotation at full draw.',
  },
  leverArm: {
    term: 'lever arm',
    text: 'Lever arm: perpendicular distance from the axle centre to the line of a cord at its contact point on the track pitch line. The cord tension times the lever arm is the torque of that cord on the cam.',
  },
  radiusOfCurvature: {
    term: 'radius of curvature',
    text: 'Radius of curvature: radius of the circle that matches the bend of a track pitch line at a point, ρ = p + p\'\' with the lever arm p as a function of the contact angle. A smaller value is a sharper bend.',
  },
  bendRadius: {
    term: 'minimum bend radius',
    text: 'Minimum bend radius: smallest radius of curvature allowed on a track pitch line. The solver uses the larger of this value and half the cord diameter plus 0.2 mm, so the groove bottom stays convex.',
  },
  wall: {
    term: 'minimum wall',
    text: 'Minimum wall: smallest material thickness between the bottom of a track groove and the axle bore. Every groove bottom stays at least the bore radius plus this wall from the axle centre.',
  },
  workingArc: {
    term: 'working arc',
    text: 'Working arc: part of the string track the string leaves from between brace and full draw. The rest of the track only closes the cam outline.',
  },  timing: {
    term: 'cam timing',
    text: 'Cam timing: difference of the rotations of the top and the bottom cam at the same draw position, Δθ = θ top − θ bottom. Cams in time turn together and reach their draw stops at the same draw position.',
  },
  nockTravel: {
    term: 'nock travel',
    text: 'Nock travel: vertical movement of the nock point over the draw when the archer pulls only horizontally, from its highest to its lowest position.',
  },
  drawStop: {
    term: 'draw stop',
    text: 'Draw stop: peg on the cam that touches the power cable at full draw and ends the draw. The gap is its clearance to the cable.',
  },
});

let counter = 0;

const supportsPopover = typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');

/**
 * Place a popover below its button, or above it when there is no room
 * below, inside the viewport. The height is known only while the popover
 * is shown.
 * @param {HTMLElement} pop
 * @param {HTMLElement} button
 */
function place(pop, button) {
  const r = button.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const width = Math.min(320, vw - 16);
  const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, vw - width - 8));
  pop.style.width = `${width}px`;
  pop.style.left = `${left}px`;
  const h = pop.offsetHeight;
  const below = r.bottom + 6;
  const above = r.top - 6 - h;
  const top = below + h > vh - 8 && above >= 8 ? above : Math.max(8, Math.min(below, vh - 8 - h));
  pop.style.top = `${top}px`;
}

/**
 * Info button with a popover definition. Returns a wrapper element that
 * holds the button and the popover.
 * @param {keyof typeof GLOSSARY} key
 * @returns {HTMLSpanElement}
 */
export function infoButton(key) {
  const entry = GLOSSARY[key];
  const id = `glossary-${key}-${++counter}`;
  const button = h('button', {
    type: 'button',
    class: 'info',
    'aria-label': `What is ${entry.term}?`,
    'aria-expanded': 'false',
    'aria-controls': id,
    'data-testid': `info-${key}`,
  }, 'i');
  const pop = h('span', { id, class: 'glossary-pop', 'data-testid': `glossary-${key}` }, entry.text);
  const wrap = h('span', { class: 'info-wrap' }, button, pop);
  if (supportsPopover) {
    pop.setAttribute('popover', 'auto');
    button.setAttribute('popovertarget', id);
    // A popover at a fixed position does not follow its button: close it on
    // scroll and resize.
    const close = () => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    };
    pop.addEventListener('beforetoggle', (event) => {
      const open = /** @type {ToggleEvent} */ (event).newState === 'open';
      if (open) place(pop, button);
      button.setAttribute('aria-expanded', String(open));
    });
    pop.addEventListener('toggle', (event) => {
      if (/** @type {ToggleEvent} */ (event).newState === 'open') {
        place(pop, button);
        window.addEventListener('scroll', close, { capture: true, passive: true });
        window.addEventListener('resize', close, { passive: true });
      } else {
        window.removeEventListener('scroll', close, { capture: true });
        window.removeEventListener('resize', close);
      }
    });
  } else {
    pop.hidden = true;
    pop.classList.add('glossary-inline');
    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      if (event.key === 'Escape') {
        close();
        button.focus();
      }
    };
    /** @param {PointerEvent} event */
    const onDown = (event) => {
      if (!wrap.contains(/** @type {Node} */ (event.target))) close();
    };
    const close = () => {
      pop.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
    button.addEventListener('click', () => {
      if (!pop.hidden) {
        close();
        return;
      }
      pop.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      document.addEventListener('keydown', onKey);
      document.addEventListener('pointerdown', onDown);
    });
  }
  return wrap;
}
