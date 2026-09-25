import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_POINTS, MIN_GAP, pointMetrics } from '../../src/core/curve.js';
import { AMO_OFFSET, INCH } from '../../src/core/units.js';
import { defaultState } from '../../src/state/presets.js';
import {
  FIELDS, SCHEMA_VERSION, drawLengthMessage, fromJSON, migrate, rangeMessage, specValue, toJSON, validate,
  validateField, validatePoints,
} from '../../src/state/schema.js';

/** @typedef {import('../../src/state/schema.js').ProjectState} ProjectState */

/**
 * Default state with a change applied to a deep copy.
 * @param {(s: any) => void} change
 * @returns {any}
 */
function modified(change) {
  const s = structuredClone(defaultState());
  change(s);
  return s;
}

/**
 * @param {unknown} state
 * @param {string} path
 */
function messagesAt(state, path) {
  return validate(state)
    .filter((e) => e.path === path)
    .map((e) => e.message);
}

describe('default preset', () => {
  it('has the values from the plan', () => {
    const s = defaultState();
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.geometry.ata / INCH).toBeCloseTo(33, 12);
    expect(s.geometry.braceHeight / INCH).toBeCloseTo(6.5, 12);
    expect(s.geometry.drawLength / INCH).toBeCloseTo(29, 12);
    expect(s.curve.params.peak).toBe(267);
    expect(s.curve.params.letOff).toBe(0.75);
    expect(s.cords.stringDiameter).toBe(0.0025);
    expect(s.curve.mode).toBe('parametric');
    expect(s.units).toEqual({ draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' });
  });

  it('is valid and its curve meets the parameters', () => {
    const s = defaultState();
    expect(validate(s)).toEqual([]);
    const m = pointMetrics(s.curve.points);
    expect(m.peak).toBeCloseTo(267, 9);
    expect(m.letOff).toBeCloseTo(0.75, 9);
    expect(s.curve.points[0].x).toBe(s.geometry.braceHeight);
    expect(s.curve.points.at(-1)?.x).toBeCloseTo(s.geometry.drawLength - AMO_OFFSET, 15);
  });

  it('returns a new object on every call', () => {
    const a = defaultState();
    const b = defaultState();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.curve.points).not.toBe(b.curve.points);
  });
});

describe('validate', () => {
  it('reports ranges in plain words with units', () => {
    expect(messagesAt(modified((s) => (s.geometry.braceHeight = 3 * INCH)), 'geometry.braceHeight')).toEqual([
      'Brace height must be between 4 and 10 in',
    ]);
    expect(messagesAt(modified((s) => (s.geometry.ata = 50 * INCH)), 'geometry.ata')).toEqual([
      'Axle-to-axle length must be between 26 and 42 in',
    ]);
    expect(messagesAt(modified((s) => (s.curve.params.peak = 1000)), 'curve.params.peak')).toEqual([
      'Peak draw force must be between 50 and 900 N',
    ]);
    expect(messagesAt(modified((s) => (s.curve.params.letOff = 0.99)), 'curve.params.letOff')).toEqual([
      'Let-off must be between 0 and 95 %',
    ]);
    expect(messagesAt(modified((s) => (s.cords.stringDiameter = 0.01)), 'cords.stringDiameter')).toEqual([
      'String diameter must be between 0.5 and 6 mm',
    ]);
    expect(messagesAt(modified((s) => (s.limb.stiffness = 10)), 'limb.stiffness')).toEqual([
      'Limb stiffness must be between 1 and 1000 N/mm',
    ]);
    expect(messagesAt(modified((s) => (s.body.leadInWrap = 4)), 'body.leadInWrap')).toEqual([
      'Lead-in wrap must be between 0 and 180 deg',
    ]);
  });

  it('requires every numeric field to be finite', () => {
    for (const path of Object.keys(FIELDS)) {
      const [section, key, sub] = path.split('.');
      const s = modified((st) => {
        if (sub) st[section][key][sub] = NaN;
        else st[section][key] = Infinity;
      });
      expect(validate(s).map((e) => e.path)).toContain(path);
    }
    expect(messagesAt(modified((s) => (s.geometry.ata = '33')), 'geometry.ata')).toEqual(['Axle-to-axle length must be a number']);
  });

  it('checks the draw length against the brace height', () => {
    const s = modified((st) => {
      st.geometry.braceHeight = 9 * INCH;
      st.geometry.drawLength = 15.5 * INCH;
    });
    expect(messagesAt(s, 'geometry.drawLength')).toContain(
      'Draw length must be more than 15.75 in: brace height + 1.75 in + 5 in of power stroke',
    );
    expect(drawLengthMessage(6.5 * INCH, 29 * INCH)).toBeNull();
  });

  it('checks enumerations', () => {
    expect(messagesAt(modified((s) => (s.units.force = 'kg')), 'units.force')).toEqual(['Force unit must be one of N, lbf']);
    expect(messagesAt(modified((s) => (s.curve.mode = 'free')), 'curve.mode')).toHaveLength(1);
  });

  it('checks structure', () => {
    expect(validate(null)).toEqual([{ path: '', message: 'The project data is not an object' }]);
    expect(validate(modified((s) => delete s.body)).map((e) => e.path)).toEqual(['body']);
    expect(validate(modified((s) => (s.curve.params = 5))).map((e) => e.path)).toEqual(['curve.params']);
    expect(validate(modified((s) => (s.schemaVersion = 2))).map((e) => e.path)).toContain('schemaVersion');
  });

  it('checks track and limb consistency', () => {
    expect(messagesAt(modified((s) => (s.stringTrack.offset = 0.05)), 'stringTrack.offset')).toEqual([
      'String track offset must be smaller than the radius',
    ]);
    const ellipse = modified((s) => {
      s.stringTrack.shape = 'ellipse';
      s.stringTrack.offset = 0.045;
    });
    expect(messagesAt(ellipse, 'stringTrack.offset')).toEqual(['String track offset must be smaller than the semi-minor axis']);
    const wide = modified((s) => (s.stringTrack.semiMinor = 0.055));
    expect(messagesAt(wide, 'stringTrack.semiMinor')).toEqual([
      'String track semi-minor axis must not exceed the semi-major axis',
    ]);
    expect(messagesAt(modified((s) => (s.limb.table = [{ travel: 'a', force: 1 }])), 'limb.table')).toHaveLength(1);
    expect(messagesAt(modified((s) => (s.limb.mode = 'table')), 'limb.table')).toEqual(['The limb table needs at least 3 rows']);
  });
});

describe('validatePoints', () => {
  const s = defaultState();
  const g = s.geometry;
  const points = s.curve.points;

  it('accepts the default curve', () => {
    expect(validatePoints(points, g)).toEqual([]);
  });

  it('reports missing, short, long and malformed point lists', () => {
    expect(validatePoints(undefined, g)[0].message).toMatch(/missing/);
    expect(validatePoints(points.slice(0, 2), g)[0].message).toBe('The force curve needs at least 3 points');
    const many = Array.from({ length: MAX_POINTS + 1 }, (_, i) => ({ x: i, F: 1 }));
    expect(validatePoints(many, g)[0].message).toMatch(/at most 50/);
    expect(validatePoints([points[0], { x: 0.3 }, points[6]], g)[0].message).toBe('Point 2 must have a numeric draw length and force');
  });

  it('reports order, end positions and forces', () => {
    const bad = structuredClone(points);
    bad[0] = { x: g.braceHeight + 0.01, F: 5 };
    bad[3].x = bad[2].x;
    bad[4].F = 6000;
    bad[6].x += 0.01;
    const messages = validatePoints(bad, g).map((e) => e.message);
    expect(messages).toEqual([
      'Point 4 must be at a longer draw length than point 3',
      'Point 1 must be at brace height',
      'Point 1 must have a force of 0 N',
      'Point 7 must be at full draw',
      'Point 5: force must be between 1 and 5000 N',
    ]);
  });

  it('reports points closer than 0.1 in, within a rounding tolerance', () => {
    const close = structuredClone(points);
    close[3].x = close[2].x + MIN_GAP / 2;
    expect(validatePoints(close, g).map((e) => e.message)).toEqual(['Point 4 must be at least 0.1 in from point 3']);
    close[3].x = close[2].x + MIN_GAP * (1 - 1e-12);
    expect(validatePoints(close, g)).toEqual([]);
  });
});

describe('field helpers', () => {
  it('formats range messages and converts values', () => {
    expect(rangeMessage(FIELDS['curve.params.riseFraction'])).toBe('Rise to peak must be between 10 and 60 %');
    expect(specValue(FIELDS['geometry.braceHeight'], 6.5 * INCH)).toBeCloseTo(6.5, 12);
    expect(validateField('geometry.braceHeight', 6.5 * INCH)).toBeNull();
  });
});

describe('JSON codec', () => {
  it('round trips the default state', () => {
    const s = defaultState();
    const { state, errors } = fromJSON(toJSON(s));
    expect(errors).toEqual([]);
    expect(state).toEqual(s);
  });

  it('round trips a custom state', () => {
    const s = modified((st) => {
      st.curve.mode = 'custom';
      st.curve.points[3].F = 255.123456789;
      st.units.force = 'lbf';
    });
    expect(fromJSON(toJSON(s))).toEqual({ state: s, errors: [] });
  });

  it('returns the default preset and a message for invalid JSON', () => {
    const r = fromJSON('{not json');
    expect(r.state).toEqual(defaultState());
    expect(r.errors[0].message).toBe('The project data is not valid JSON');
  });

  it('returns the default preset for invalid values', () => {
    const r = fromJSON(toJSON(modified((s) => (s.geometry.braceHeight = 1))));
    expect(r.state).toEqual(defaultState());
    expect(r.errors[0].message).toBe('Brace height must be between 4 and 10 in');
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (text) => {
        const r = fromJSON(text);
        expect(validate(r.state)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('never throws on the default project with changed or removed fields (property)', () => {
    // Every path of the default state, including array entries.
    /** @type {string[][]} */
    const paths = [];
    /**
     * @param {any} v
     * @param {string[]} path
     */
    const walk = (v, path) => {
      if (path.length > 0) paths.push(path);
      if (v !== null && typeof v === 'object') for (const key of Object.keys(v)) walk(v[key], [...path, key]);
    };
    const base = defaultState();
    walk(base, []);
    const edit = fc.record({ path: fc.constantFrom(...paths), value: fc.option(fc.jsonValue(), { nil: undefined }) });
    fc.assert(
      fc.property(fc.array(edit, { minLength: 1, maxLength: 3 }), (edits) => {
        /** @type {any} */
        const data = structuredClone(base);
        for (const { path, value } of edits) {
          let parent = data;
          for (const key of path.slice(0, -1)) parent = parent !== null && typeof parent === 'object' ? parent[key] : undefined;
          if (parent === null || typeof parent !== 'object') continue;
          if (value === undefined) delete parent[path[path.length - 1]];
          else parent[path[path.length - 1]] = value;
        }
        const text = JSON.stringify(data);
        const r = fromJSON(text);
        expect(validate(r.state)).toEqual([]);
        if (r.errors.length === 0) expect(r.state).toEqual(migrate(JSON.parse(text)).state);
        else expect(r.state).toEqual(base);
      }),
      { numRuns: 2000 },
    );
  }, 60_000);

  it('reports fields that are objects with a toString that is not a function', () => {
    for (const [section, key] of [['stringTrack', 'radius'], ['stringTrack', 'semiMajor'], ['geometry', 'drawLength']]) {
      const text = JSON.stringify(modified((s) => (s[section][key] = { toString: {} })));
      const r = fromJSON(text);
      expect(r.state).toEqual(defaultState());
      expect(r.errors.map((e) => e.path)).toContain(`${section}.${key}`);
    }
  });
});

describe('migrate', () => {
  it('rejects newer versions with a clear message', () => {
    const r = migrate({ ...defaultState(), schemaVersion: 2 });
    expect(r.state).toBeNull();
    expect(r.errors[0].message).toBe(
      'The project was saved by a newer version of the app (schema version 2); this version reads schema version 1',
    );
    expect(fromJSON(JSON.stringify({ schemaVersion: 7 })).errors[0].message).toMatch(/newer version/);
  });

  it('rejects missing and unknown versions', () => {
    expect(migrate({}).errors[0].message).toBe('The project data has no schema version');
    expect(migrate({ schemaVersion: 0 }).errors[0].message).toBe('The schema version 0 is unknown');
    expect(migrate({ schemaVersion: '1' }).errors[0].message).toBe('The schema version "1" is unknown');
    expect(migrate([]).errors[0].message).toBe('The project data is not an object');
  });

  it('fills missing fields with defaults and drops unknown keys', () => {
    const data = /** @type {any} */ (structuredClone(defaultState()));
    delete data.body;
    delete data.limb.maxRotation;
    data.extra = 1;
    data.curve.points[2].note = 'x';
    const r = migrate(data);
    expect(r.errors).toEqual([]);
    expect(r.state).toEqual(defaultState());
  });
});
