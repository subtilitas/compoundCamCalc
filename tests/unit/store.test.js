import { describe, expect, it, vi } from 'vitest';
import { MIN_GAP, pointMetrics } from '../../src/core/curve.js';
import { AMO_OFFSET, INCH } from '../../src/core/units.js';
import { defaultState } from '../../src/state/presets.js';
import { SAMPLES } from '../../src/state/samples.js';
import { HISTORY_LIMIT, createStore, reduce } from '../../src/state/store.js';

/** @typedef {import('../../src/state/schema.js').ProjectState} ProjectState */

/**
 * @param {ProjectState} state
 * @param {number} index
 * @param {number} F
 */
function withForce(state, index, F) {
  const points = state.curve.points.map((p) => ({ ...p }));
  points[index].F = F;
  return points;
}

describe('replace', () => {
  it('switches the state, clears the history and any gesture, and is not undoable', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setGeometry', geometry: { ata: 34 * INCH } });
    store.beginTransaction();
    store.dispatch({ type: 'setGeometry', geometry: { ata: 35 * INCH } });
    /** @type {{ replaced: boolean }[]} */
    const seen = [];
    store.subscribe((_s, _p, info) => seen.push(info));
    const other = SAMPLES[2].state();
    expect(store.replace(other)).toEqual([]);
    expect(store.getState()).toBe(other);
    expect(store.inTransaction()).toBe(false);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(store.undo()).toBe(false);
    expect(seen).toEqual([{ replaced: true }]);
    // An equal state still notifies, so views reset for the new design.
    store.replace(defaultState());
    store.replace(defaultState());
    expect(seen).toHaveLength(3);
    store.dispatch({ type: 'setGeometry', geometry: { ata: 30 * INCH } });
    expect(seen.at(-1)).toEqual({ replaced: false });
  });

  it('refuses an invalid state and keeps everything', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setGeometry', geometry: { ata: 34 * INCH } });
    const before = store.getState();
    const bad = defaultState();
    bad.geometry.ata = 0.01;
    expect(store.replace(bad).length).toBeGreaterThan(0);
    expect(store.getState()).toBe(before);
    expect(store.canUndo()).toBe(true);
  });
});

describe('createStore', () => {
  it('starts with the initial state', () => {
    const initial = defaultState();
    const store = createStore(initial);
    expect(store.getState()).toBe(initial);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('sets units with undo and redo', () => {
    const store = createStore(defaultState());
    expect(store.dispatch({ type: 'setUnits', units: { force: 'lbf' } })).toEqual([]);
    expect(store.getState().units.force).toBe('lbf');
    expect(store.getState().units.draw).toBe('in');
    expect(store.undo()).toBe(true);
    expect(store.getState().units.force).toBe('N');
    expect(store.canRedo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.getState().units.force).toBe('lbf');
  });

  it('rejects invalid changes and keeps the state', () => {
    const store = createStore(defaultState());
    const before = store.getState();
    const errors = store.dispatch({ type: 'setGeometry', geometry: { braceHeight: 1 * INCH } });
    expect(errors.map((e) => e.message)).toContain('Brace height must be between 1.5 and 10 in');
    expect(store.getState()).toBe(before);
    expect(store.dispatch({ type: 'setCurveParams', params: { peak: 2000 } })).toHaveLength(1);
    expect(store.dispatch({ type: 'setUnits', units: { force: /** @type {any} */ ('kg') } })).toHaveLength(1);
    expect(store.canUndo()).toBe(false);
  });

  it('does not record changes that change nothing', () => {
    const store = createStore(defaultState());
    expect(store.dispatch({ type: 'setUnits', units: { force: 'N' } })).toEqual([]);
    expect(store.canUndo()).toBe(false);
  });

  it('notifies subscribers until they unsubscribe', () => {
    const store = createStore(defaultState());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.dispatch({ type: 'setUnits', units: { draw: 'mm' } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].units.draw).toBe('mm');
    expect(listener.mock.calls[0][1].units.draw).toBe('in');
    off();
    store.dispatch({ type: 'setUnits', units: { draw: 'cm' } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('caps the history at 100 entries', () => {
    const store = createStore(defaultState());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 3, 200 + i) });
    }
    let undos = 0;
    while (store.undo()) undos++;
    expect(undos).toBe(HISTORY_LIMIT);
    expect(store.getState().curve.points[3].F).toBe(219);
  });

  it('clears redo after a new change', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setUnits', units: { force: 'lbf' } });
    store.undo();
    store.dispatch({ type: 'setUnits', units: { draw: 'mm' } });
    expect(store.canRedo()).toBe(false);
  });
});

describe('transactions', () => {
  it('records one entry for a gesture', () => {
    const store = createStore(defaultState());
    const initial = store.getState();
    expect(store.beginTransaction()).toBe(true);
    expect(store.beginTransaction()).toBe(false);
    expect(store.inTransaction()).toBe(true);
    for (const F of [260, 250, 240]) store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 3, F) });
    // Undo waits for the end of the gesture.
    expect(store.canUndo()).toBe(false);
    expect(store.commitTransaction()).toBe(true);
    expect(store.canUndo()).toBe(true);
    expect(store.inTransaction()).toBe(false);
    expect(store.getState().curve.points[3].F).toBe(240);
    store.undo();
    expect(store.getState()).toBe(initial);
    expect(store.canUndo()).toBe(false);
  });

  it('restores the start state on cancel', () => {
    const store = createStore(defaultState());
    const initial = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.beginTransaction();
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 3, 100) });
    expect(store.cancelTransaction()).toBe(true);
    expect(store.getState()).toBe(initial);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.cancelTransaction()).toBe(false);
    expect(store.commitTransaction()).toBe(false);
    expect(store.canUndo()).toBe(false);
  });

  it('records nothing for an empty gesture', () => {
    const store = createStore(defaultState());
    store.beginTransaction();
    store.commitTransaction();
    expect(store.canUndo()).toBe(false);
  });

  it('refuses undo and redo during an open gesture', () => {
    const store = createStore(defaultState());
    const initial = store.getState();
    store.dispatch({ type: 'setUnits', units: { force: 'lbf' } });
    store.undo();
    store.beginTransaction();
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 3, 100) });
    const during = store.getState();
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(store.getState()).toBe(during);
    expect(store.inTransaction()).toBe(true);
    // Later moves of the gesture stay in the same entry.
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 3, 90) });
    store.commitTransaction();
    expect(store.undo()).toBe(true);
    expect(store.getState()).toBe(initial);
    expect(store.canUndo()).toBe(false);
  });
});

describe('curve actions', () => {
  it('switches to custom mode and syncs peak and let-off when points change', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 3, 300) });
    const s = store.getState();
    expect(s.curve.mode).toBe('custom');
    expect(s.curve.params.peak).toBeCloseTo(300, 9);
    const hold = (1 - defaultState().curve.params.letOff) * 267;
    expect(s.curve.params.letOff).toBeCloseTo(1 - hold / 300, 9);
  });

  it('keeps the mode and the history when the points do not change', () => {
    const store = createStore(defaultState());
    const before = store.getState();
    expect(store.dispatch({ type: 'setCurvePoints', points: withForce(before, 6, before.curve.points[6].F) })).toEqual([]);
    expect(store.getState()).toBe(before);
    expect(store.getState().curve.mode).toBe('parametric');
    expect(store.canUndo()).toBe(false);
  });

  it('clamps synced parameters to their ranges', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 3, 1200) });
    expect(store.getState().curve.params.peak).toBe(900);
  });

  it('regenerates parametric curves when parameters change', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setCurveParams', params: { peak: 300, letOff: 0.7 } });
    const s = store.getState();
    expect(s.curve.mode).toBe('parametric');
    const m = pointMetrics(s.curve.points);
    expect(m.peak).toBeCloseTo(300, 9);
    expect(m.letOff).toBeCloseTo(0.7, 9);
  });

  it('scales custom curves with the peak and let-off parameters', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 4, 180) });
    const before = store.getState().curve.points;
    store.dispatch({ type: 'setCurveParams', params: { peak: 200 } });
    let s = store.getState();
    expect(s.curve.mode).toBe('custom');
    expect(s.curve.points[4].F).toBeCloseTo((180 * 200) / 267, 9);
    expect(s.curve.params.peak).toBeCloseTo(200, 9);
    store.dispatch({ type: 'setCurveParams', params: { letOff: 0.6 } });
    s = store.getState();
    expect(pointMetrics(s.curve.points).letOff).toBeCloseTo(0.6, 9);
    expect(s.curve.params.letOff).toBeCloseTo(0.6, 9);
    store.dispatch({ type: 'setCurveParams', params: { riseFraction: 0.4 } });
    expect(store.getState().curve.points).toEqual(s.curve.points);
    expect(store.getState().curve.params.riseFraction).toBe(0.4);
    expect(before).not.toBe(s.curve.points);
  });

  it('restores a custom curve after let-off 0 %', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 5, 54.4) });
    const start = store.getState().curve;
    store.dispatch({ type: 'setCurveParams', params: { letOff: 0 } });
    expect(pointMetrics(store.getState().curve.points).letOff).toBeLessThan(1e-5);
    store.dispatch({ type: 'setCurveParams', params: { letOff: start.params.letOff } });
    const end = store.getState().curve;
    expect(end.params.letOff).toBeCloseTo(start.params.letOff, 9);
    end.points.forEach((p, i) => expect(p.F).toBeCloseTo(start.points[i].F, 6));
  });

  it('applies the values of one slider gesture to the points at its start', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 5, 60) });
    let base = store.getState().curve.points;
    const letOff = store.getState().curve.params.letOff;
    store.beginTransaction();
    for (const v of [0.5, 0, 0.3, letOff]) store.dispatch({ type: 'setCurveParams', params: { letOff: v }, basePoints: base });
    store.commitTransaction();
    store.getState().curve.points.forEach((p, i) => expect(p.F).toBeCloseTo(base[i].F, 9));

    // A 3 N point clamped to 1 N at a 50 N peak comes back at 3 N.
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 1, 3) });
    base = store.getState().curve.points;
    store.beginTransaction();
    for (const peak of [100, 50, 267]) store.dispatch({ type: 'setCurveParams', params: { peak }, basePoints: base });
    store.commitTransaction();
    expect(store.getState().curve.points[1].F).toBe(3);
    store.getState().curve.points.forEach((p, i) => expect(p.F).toBeCloseTo(base[i].F, 9));
  });

  it('regenerates from parameters on request', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 4, 180) });
    store.dispatch({ type: 'regenerateCurve' });
    const s = store.getState();
    expect(s.curve.mode).toBe('parametric');
    expect(s.curve.points).toEqual(defaultState().curve.points);
  });
});

describe('geometry actions', () => {
  it('regenerates a parametric curve for a new draw length', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setGeometry', geometry: { drawLength: 28 * INCH } });
    const points = store.getState().curve.points;
    expect(points.at(-1)?.x).toBeCloseTo(28 * INCH - AMO_OFFSET, 15);
    expect(pointMetrics(points).peak).toBeCloseTo(267, 9);
  });

  it('rescales interior points of a custom curve proportionally', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 4, 180) });
    const old = store.getState().curve.points;
    const b0 = old[0].x;
    const f0 = old.at(-1)?.x ?? 0;
    store.dispatch({ type: 'setGeometry', geometry: { braceHeight: 7 * INCH, drawLength: 30 * INCH } });
    const next = store.getState().curve.points;
    const b1 = 7 * INCH;
    const f1 = 30 * INCH - AMO_OFFSET;
    expect(next[0].x).toBe(b1);
    expect(next.at(-1)?.x).toBe(f1);
    for (let i = 1; i < next.length - 1; i++) {
      expect((next[i].x - b1) / (f1 - b1)).toBeCloseTo((old[i].x - b0) / (f0 - b0), 12);
      expect(next[i].F).toBe(old[i].F);
      expect(next[i].x - next[i - 1].x).toBeGreaterThan(MIN_GAP / 2);
    }
    expect(store.getState().curve.mode).toBe('custom');
  });

  it('keeps the minimum gap when a shorter stroke squeezes the points', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setCurveParams', params: { valleyWidth: 0.5 * INCH } });
    const generated = store.getState().curve.points;
    expect(generated[6].x - generated[5].x).toBeCloseTo(MIN_GAP, 12);
    store.dispatch({ type: 'setCurvePoints', points: withForce(store.getState(), 3, 260) });
    expect(store.dispatch({ type: 'setGeometry', geometry: { drawLength: 22 * INCH } })).toEqual([]);
    const next = store.getState().curve.points;
    expect(next.at(-1)?.x).toBeCloseTo(22 * INCH - AMO_OFFSET, 15);
    for (let i = 1; i < next.length; i++) {
      expect(next[i].x - next[i - 1].x).toBeGreaterThanOrEqual(MIN_GAP - 1e-12);
      expect(next[i].F).toBe(i === 3 ? 260 : generated[i].F);
    }
  });

  it('drops the points a short stroke cannot hold at the minimum gap', () => {
    const store = createStore(defaultState());
    const { xBrace, xFull } = { xBrace: store.getState().curve.points[0].x, xFull: store.getState().curve.points.at(-1)?.x ?? 0 };
    const points = Array.from({ length: 50 }, (_, i) => ({ x: xBrace + ((xFull - xBrace) * i) / 49, F: i === 0 ? 0 : 100 + i }));
    expect(store.dispatch({ type: 'setCurvePoints', points })).toEqual([]);
    // 2.1 in of power stroke holds 22 points 0.1 in apart.
    const drawLength = store.getState().geometry.braceHeight + AMO_OFFSET + 2.1 * INCH;
    expect(store.dispatch({ type: 'setGeometry', geometry: { drawLength } })).toEqual([]);
    const next = store.getState().curve.points;
    expect(next).toHaveLength(22);
    expect(next[0]).toEqual({ x: next[0].x, F: 0 });
    expect(next.at(-1)?.F).toBe(149);
    for (let i = 1; i < next.length; i++) expect(next[i].x - next[i - 1].x).toBeGreaterThanOrEqual(MIN_GAP - 1e-12);
    store.undo();
    expect(store.getState().curve.points).toHaveLength(50);
  });

  it('keeps the curve when only the ATA changes', () => {
    const store = createStore(defaultState());
    const points = store.getState().curve.points;
    store.dispatch({ type: 'setGeometry', geometry: { ata: 34 * INCH } });
    expect(store.getState().curve.points).toBe(points);
  });

  it('rejects a draw length too short for the brace height', () => {
    const store = createStore(defaultState());
    const errors = store.dispatch({ type: 'setGeometry', geometry: { drawLength: 10 * INCH } });
    expect(errors.length).toBeGreaterThan(0);
    expect(store.getState().geometry.drawLength).toBeCloseTo(29 * INCH, 15);
  });
});

describe('other actions', () => {
  it('merges limb, track, cord and body sections', () => {
    const store = createStore(defaultState());
    store.dispatch({ type: 'setLimb', limb: { stiffness: 30e3 } });
    store.dispatch({ type: 'setStringTrack', stringTrack: { radius: 0.04 } });
    store.dispatch({ type: 'setCords', cords: { cableDiameter: 0.003 } });
    store.dispatch({ type: 'setBody', body: { minWall: 0.004 } });
    const s = store.getState();
    expect([s.limb.stiffness, s.stringTrack.radius, s.cords.cableDiameter, s.body.minWall]).toEqual([30e3, 0.04, 0.003, 0.004]);
    expect(s.limb.mode).toBe('stiffness');
  });

  it('loads a whole project as one undo step', () => {
    const store = createStore(defaultState());
    const other = defaultState();
    other.units.force = 'lbf';
    store.dispatch({ type: 'load', state: other });
    expect(store.getState()).toBe(other);
    store.undo();
    expect(store.getState().units.force).toBe('N');
  });

  it('throws on an unknown action type', () => {
    expect(() => reduce(defaultState(), /** @type {any} */ ({ type: 'explode' }))).toThrow(/Unknown action/);
  });
});
