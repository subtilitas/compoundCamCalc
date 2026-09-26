import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMainThreadWorker, createScheduler, createSolver } from '../../src/ui/solver.js';
import { answer, failedResult } from '../../src/worker/solver.worker.js';
import { defaultState } from '../../src/state/presets.js';

/** @typedef {import('../../src/core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../../src/state/schema.js').ProjectState} ProjectState */

/**
 * Stand-in result marked with a tag.
 * @param {string} tag
 * @returns {SolveResult}
 */
const fake = (tag) => /** @type {SolveResult} */ (/** @type {unknown} */ ({ status: 'ok', tag }));

/**
 * Stand-in state marked with a tag.
 * @param {string} tag
 * @returns {ProjectState}
 */
const st = (tag) => /** @type {ProjectState} */ (/** @type {unknown} */ ({ tag }));

/** Fake worker that records posted messages and answers on demand. */
function fakeWorker() {
  /** @type {any[]} */
  const posted = [];
  const w = {
    posted,
    terminated: false,
    /** @type {((e: { data: any }) => void) | null} */
    onmessage: null,
    /** @type {((e: unknown) => void) | null} */
    onerror: null,
    /** @param {any} data */
    postMessage(data) {
      posted.push(data);
    },
    terminate() {
      w.terminated = true;
    },
    /**
     * Answer the message at index i with a result tagged by its state.
     * @param {number} i
     */
    reply(i) {
      const m = posted[i];
      w.onmessage?.({ data: { id: m.id, resolution: m.resolution, result: fake(m.state.tag) } });
    },
    fail() {
      w.onerror?.(new Error('boom'));
    },
  };
  return w;
}

/** Fake worker that uses addEventListener instead of handler properties. */
function listenerWorker() {
  const base = fakeWorker();
  /** @type {Record<string, ((e: any) => void)[]>} */
  const listeners = {};
  return Object.assign(base, {
    /**
     * @param {string} type
     * @param {(e: any) => void} fn
     */
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    /** @param {number} i */
    reply(i) {
      const m = base.posted[i];
      for (const fn of listeners.message ?? []) fn({ data: { id: m.id, resolution: m.resolution, result: fake(m.state.tag) } });
    },
    fail() {
      for (const fn of listeners.error ?? []) fn(new Event('error'));
    },
  });
}

/** Client with a list of spawned fake workers and recorded callbacks. */
function setup(make = fakeWorker) {
  /** @type {ReturnType<typeof fakeWorker>[]} */
  const workers = [];
  /** @type {{ tag: string, resolution: string, state: any }[]} */
  const results = [];
  /** @type {string[]} */
  const statuses = [];
  const client = createSolver({
    spawn: () => {
      const w = make();
      workers.push(w);
      return w;
    },
    onResult: (result, resolution, state) => results.push({ tag: /** @type {any} */ (result).tag, resolution, state }),
    onStatus: (s) => statuses.push(s),
  });
  return { client, workers, results, statuses };
}

describe('createScheduler', () => {
  /** Scheduler with recorded hooks. */
  function sched() {
    /** @type {number[]} */
    const sent = [];
    /** @type {number[]} */
    const delivered = [];
    /** @type {string[]} */
    const statuses = [];
    const s = createScheduler({
      send: (job) => sent.push(job.id),
      deliver: (job) => delivered.push(job.id),
      status: (x) => statuses.push(x),
    });
    return { s, sent, delivered, statuses };
  }

  it('sends at once when idle and delivers the result', () => {
    const { s, sent, delivered, statuses } = sched();
    const a = s.request(st('a'), 'full');
    expect(sent).toEqual([a.id]);
    expect(s.receive(a.id, fake('a'))).toBe(true);
    expect(delivered).toEqual([a.id]);
    expect(statuses).toEqual(['busy', 'idle']);
    expect(s.status()).toBe('idle');
  });

  it('keeps only the newest pending request and still delivers the finished one', () => {
    const { s, sent, delivered, statuses } = sched();
    const a = s.request(st('a'), 'coarse');
    s.request(st('b'), 'coarse');
    const c = s.request(st('c'), 'full');
    expect(sent).toEqual([a.id]);
    expect(s.pending()?.id).toBe(c.id);
    expect(s.receive(a.id, fake('a'))).toBe(true);
    expect(sent).toEqual([a.id, c.id]);
    expect(delivered).toEqual([a.id]);
    expect(s.status()).toBe('busy');
    expect(s.receive(c.id, fake('c'))).toBe(true);
    expect(delivered).toEqual([a.id, c.id]);
    expect(statuses).toEqual(['busy', 'idle']);
  });

  it('delivers every finished result when requests come every tick and each solve takes longer', () => {
    const { s, sent, delivered, statuses } = sched();
    // Each solve takes 2.5 ticks; a new request arrives every tick.
    const solveTicks = 2.5;
    let doneAt = -1;
    for (let tick = 0; tick < 20; tick++) {
      s.request(st(`t${tick}`), 'coarse');
      if (doneAt < 0) doneAt = tick + solveTicks;
      if (tick >= doneAt) {
        const job = /** @type {any} */ (s.inFlight());
        expect(s.receive(job.id, fake(`t${job.id}`))).toBe(true);
        doneAt = s.inFlight() ? tick + solveTicks : -1;
      }
    }
    expect(delivered.length).toBeGreaterThanOrEqual(6);
    expect(delivered).toEqual(sent.slice(0, delivered.length));
    expect(statuses).toEqual(['busy']);
  });

  it('sends the pending job before delivering, so a request from deliver queues behind it', () => {
    /** @type {number[]} */
    const sent = [];
    /** @type {number[]} */
    const delivered = [];
    /** @type {ReturnType<typeof createScheduler>} */
    const s = createScheduler({
      send: (job) => sent.push(job.id),
      deliver: (job) => {
        delivered.push(job.id);
        if (job.id === 1) s.request(st('from-deliver'), 'full');
      },
      status: () => {},
    });
    s.request(st('a'), 'coarse');
    s.request(st('b'), 'coarse');
    s.receive(1, fake('a'));
    expect(sent).toEqual([1, 2]);
    expect(s.inFlight()?.id).toBe(2);
    expect(s.pending()?.id).toBe(3);
  });

  it('ignores results for jobs not in flight', () => {
    const { s, delivered } = sched();
    const a = s.request(st('a'), 'full');
    expect(s.receive(a.id + 7, fake('x'))).toBe(false);
    expect(s.receive(a.id, fake('a'))).toBe(true);
    expect(s.receive(a.id, fake('a'))).toBe(false);
    expect(delivered).toEqual([a.id]);
  });

  it('reports error, delivers nothing for the failed job and sends the pending one', () => {
    const { s, sent, delivered, statuses } = sched();
    const a = s.request(st('a'), 'full');
    const b = s.request(st('b'), 'full');
    expect(s.fail()).toBe(true);
    expect(sent).toEqual([a.id, b.id]);
    expect(s.receive(b.id, fake('b'))).toBe(true);
    expect(delivered).toEqual([b.id]);
    expect(statuses).toEqual(['busy', 'error', 'busy', 'idle']);
  });

  it('fail with a stale id or nothing in flight does nothing', () => {
    const { s, statuses } = sched();
    expect(s.fail()).toBe(false);
    const a = s.request(st('a'), 'full');
    expect(s.fail(a.id + 1)).toBe(false);
    expect(statuses).toEqual(['busy']);
  });

  it('treats any resolution other than coarse as full', () => {
    const { s } = sched();
    expect(s.request(st('a'), /** @type {any} */ ('fine')).resolution).toBe('full');
  });
});

describe('createSolver with a fake worker', () => {
  for (const [name, make] of /** @type {const} */ ([['handler properties', fakeWorker], ['addEventListener', listenerWorker]])) {
    it(`latest request wins (${name})`, () => {
      const { client, workers, results, statuses } = setup(make);
      const a = st('a');
      const c = st('c');
      client.request(a, 'coarse');
      client.request(st('b'), 'coarse');
      client.request(c, 'full');
      expect(workers).toHaveLength(1);
      const w = workers[0];
      expect(w.posted.map((m) => m.state.tag)).toEqual(['a']);
      w.reply(0);
      expect(results).toEqual([{ tag: 'a', resolution: 'coarse', state: a }]);
      expect(w.posted.map((m) => m.state.tag)).toEqual(['a', 'c']);
      w.reply(1);
      expect(results).toEqual([
        { tag: 'a', resolution: 'coarse', state: a },
        { tag: 'c', resolution: 'full', state: c },
      ]);
      expect(statuses).toEqual(['busy', 'idle']);
    });

    it(`recreates the worker once after an error (${name})`, () => {
      const { client, workers, results, statuses } = setup(make);
      client.request(st('a'), 'full');
      workers[0].fail();
      expect(workers[0].terminated).toBe(true);
      expect(workers).toHaveLength(1);
      expect(results).toEqual([]);
      expect(statuses).toEqual(['busy', 'error']);
      client.request(st('b'), 'full');
      expect(workers).toHaveLength(2);
      workers[1].reply(0);
      expect(results.map((r) => r.tag)).toEqual(['b']);
      expect(statuses).toEqual(['busy', 'error', 'busy', 'idle']);
    });
  }

  it('sends the pending request to a fresh worker after an error', () => {
    const { client, workers, results } = setup();
    client.request(st('a'), 'full');
    client.request(st('b'), 'coarse');
    workers[0].fail();
    expect(workers).toHaveLength(2);
    expect(workers[1].posted.map((m) => [m.state.tag, m.resolution])).toEqual([['b', 'coarse']]);
    workers[1].reply(0);
    expect(results.map((r) => r.tag)).toEqual(['b']);
  });

  it('ignores messages of a replaced worker', () => {
    const { client, workers, results } = setup();
    client.request(st('a'), 'full');
    workers[0].fail();
    workers[0].reply(0);
    expect(results).toEqual([]);
  });

  it('dispose terminates the worker and ignores later requests and results', () => {
    const { client, workers, results } = setup();
    client.request(st('a'), 'full');
    client.dispose();
    expect(workers[0].terminated).toBe(true);
    workers[0].reply(0);
    client.request(st('b'), 'full');
    expect(results).toEqual([]);
    expect(workers).toHaveLength(1);
  });
});

describe('createSolver failure paths', () => {
  it('reports an error when the state cannot be posted and keeps working', () => {
    let throwOnce = true;
    const { client, workers, results, statuses } = setup(() => {
      const w = fakeWorker();
      const post = w.postMessage;
      w.postMessage = (data) => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error('DataCloneError');
        }
        post(data);
      };
      return w;
    });
    client.request(st('a'), 'full');
    expect(statuses).toEqual(['busy', 'error']);
    expect(workers[0].terminated).toBe(false);
    client.request(st('b'), 'full');
    expect(workers).toHaveLength(1);
    workers[0].reply(0);
    expect(results.map((r) => r.tag)).toEqual(['b']);
    expect(statuses).toEqual(['busy', 'error', 'busy', 'idle']);
  });

  it('treats an answer without a result as a worker failure', () => {
    const { client, workers, results, statuses } = setup();
    client.request(st('a'), 'full');
    workers[0].onmessage?.({ data: { id: workers[0].posted[0].id, resolution: 'full' } });
    expect(results).toEqual([]);
    expect(workers[0].terminated).toBe(true);
    expect(statuses).toEqual(['busy', 'error']);
  });

  /** Client with a primary spawn and a fallback, both recorded. */
  function withFallback() {
    /** @type {ReturnType<typeof fakeWorker>[]} */
    const primary = [];
    /** @type {ReturnType<typeof fakeWorker>[]} */
    const backup = [];
    /** @type {string[]} */
    const results = [];
    /** @type {string[]} */
    const statuses = [];
    const client = createSolver({
      spawn: () => {
        const w = fakeWorker();
        primary.push(w);
        return w;
      },
      fallback: () => {
        const w = fakeWorker();
        backup.push(w);
        return w;
      },
      onResult: (result) => results.push(/** @type {any} */ (result).tag),
      onStatus: (s) => statuses.push(s),
    });
    return { client, primary, backup, results, statuses };
  }

  it('switches to the fallback and re-sends the job in flight when a worker fails before its first answer', () => {
    const { client, primary, backup, results, statuses } = withFallback();
    client.request(st('a'), 'full');
    const id = primary[0].posted[0].id;
    primary[0].fail();
    expect(primary[0].terminated).toBe(true);
    expect(backup).toHaveLength(1);
    expect(backup[0].posted).toEqual([{ id, state: st('a'), resolution: 'full' }]);
    expect(statuses).toEqual(['busy']);
    client.request(st('b'), 'full');
    expect(primary).toHaveLength(1);
    expect(backup).toHaveLength(1);
    backup[0].reply(0);
    expect(results).toEqual(['a']);
    backup[0].reply(1);
    expect(results).toEqual(['a', 'b']);
    expect(statuses).toEqual(['busy', 'idle']);
  });

  it('fails the job when the fallback also fails before its first answer', () => {
    const { client, primary, backup, results, statuses } = withFallback();
    client.request(st('a'), 'full');
    primary[0].fail();
    backup[0].fail();
    expect(backup[0].terminated).toBe(true);
    expect(results).toEqual([]);
    expect(statuses).toEqual(['busy', 'error']);
    client.request(st('b'), 'full');
    expect(primary).toHaveLength(1);
    expect(backup).toHaveLength(2);
    backup[1].reply(0);
    expect(results).toEqual(['b']);
    expect(statuses).toEqual(['busy', 'error', 'busy', 'idle']);
  });

  it('keeps the primary spawn when a worker fails after answering', () => {
    /** @type {ReturnType<typeof fakeWorker>[]} */
    const primary = [];
    let fallbacks = 0;
    const client = createSolver({
      spawn: () => {
        const w = fakeWorker();
        primary.push(w);
        return w;
      },
      fallback: () => {
        fallbacks++;
        return fakeWorker();
      },
      onResult: () => {},
    });
    client.request(st('a'), 'full');
    primary[0].reply(0);
    client.request(st('b'), 'full');
    primary[0].fail();
    client.request(st('c'), 'full');
    expect(primary).toHaveLength(2);
    expect(fallbacks).toBe(0);
  });
});

describe('main-thread fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers in a zero-delay timeout with latest-wins semantics', async () => {
    vi.useFakeTimers();
    /** @type {string[]} */
    const solved = [];
    const solveFn = /** @type {any} */ ((/** @type {any} */ state) => {
      solved.push(state.tag);
      return fake(state.tag);
    });
    /** @type {{ tag: string, resolution: string }[]} */
    const results = [];
    /** @type {string[]} */
    const statuses = [];
    const client = createSolver({
      spawn: () => createMainThreadWorker(() => (req) => answer(req, solveFn)),
      onResult: (result, resolution) => results.push({ tag: /** @type {any} */ (result).tag, resolution }),
      onStatus: (s) => statuses.push(s),
    });
    client.request(st('a'), 'coarse');
    client.request(st('b'), 'coarse');
    client.request(st('c'), 'full');
    expect(solved).toEqual([]);
    await vi.runAllTimersAsync();
    expect(solved).toEqual(['a', 'c']);
    expect(results).toEqual([
      { tag: 'a', resolution: 'coarse' },
      { tag: 'c', resolution: 'full' },
    ]);
    expect(statuses).toEqual(['busy', 'idle']);
  });

  it('reports a failed load as an error and recovers on the next request', async () => {
    vi.useFakeTimers();
    let loads = 0;
    /** @type {string[]} */
    const statuses = [];
    /** @type {string[]} */
    const results = [];
    const client = createSolver({
      spawn: () =>
        createMainThreadWorker(() => {
          loads++;
          if (loads === 1) throw new Error('load failed');
          return (req) => answer(req, /** @type {any} */ ((/** @type {any} */ s) => fake(s.tag)));
        }),
      onResult: (result) => results.push(/** @type {any} */ (result).tag),
      onStatus: (s) => statuses.push(s),
    });
    client.request(st('a'), 'full');
    await vi.runAllTimersAsync();
    expect(statuses).toEqual(['busy', 'error']);
    client.request(st('b'), 'full');
    await vi.runAllTimersAsync();
    expect(results).toEqual(['b']);
    expect(statuses).toEqual(['busy', 'error', 'busy', 'idle']);
  });

  it('terminate cancels the timeout', async () => {
    vi.useFakeTimers();
    const onmessage = vi.fn();
    const w = createMainThreadWorker(() => (req) => answer(req, /** @type {any} */ (() => fake('x'))));
    w.onmessage = onmessage;
    w.postMessage({ id: 1, state: st('x'), resolution: 'full' });
    w.terminate();
    await vi.runAllTimersAsync();
    expect(onmessage).not.toHaveBeenCalled();
  });

  it('the default spawn solves on the main thread when Worker is missing', async () => {
    expect(typeof Worker).toBe('undefined');
    const state = defaultState();
    const done = new Promise((resolve) => {
      const client = createSolver({ onResult: (result, resolution, s) => resolve({ result, resolution, s }) });
      client.request(state, 'coarse');
    });
    const { result, resolution, s } = /** @type {any} */ (await done);
    expect(resolution).toBe('coarse');
    expect(s).toBe(state);
    expect(result.resolution).toBe('coarse');
    expect(result.status).toBe('ok');
  }, 30000);
});

describe('worker answer', () => {
  it('echoes id and resolution and solves the state', () => {
    const solveFn = vi.fn(() => fake('ok'));
    const reply = answer({ id: 4, state: st('s'), resolution: 'coarse' }, /** @type {any} */ (solveFn));
    expect(reply.id).toBe(4);
    expect(reply.resolution).toBe('coarse');
    expect(solveFn).toHaveBeenCalledWith(st('s'), { resolution: 'coarse', analysis: false });
  });

  it('asks a full solve for the timing analysis with the length changes and the cord stiffness of the state', () => {
    const solveFn = vi.fn(() => fake('ok'));
    const state = /** @type {any} */ ({ ...st('s'), tuning: { topCable: 0.001 } });
    answer({ id: 5, state, resolution: 'full' }, /** @type {any} */ (solveFn));
    expect(solveFn).toHaveBeenCalledWith(state, { resolution: 'full', analysis: { offsets: { topCable: 0.001 }, stiffness: null } });
    const tuning = {
      topCable: 0, cordModel: 'elastic', stringMaterial: '452x', stringStrands: 20, stringEA: 1e5,
      topCableMaterial: 'custom', topCableStrands: 20, topCableEA: 2e5, bottomCableMaterial: 'dacron-b50', bottomCableStrands: 16, bottomCableEA: 1e5,
    };
    const elastic = /** @type {any} */ ({ ...st('s'), tuning });
    answer({ id: 6, state: elastic, resolution: 'full' }, /** @type {any} */ (solveFn));
    expect(solveFn).toHaveBeenLastCalledWith(elastic, {
      resolution: 'full', analysis: { offsets: tuning, stiffness: { string: 20 * 12360, topCable: 2e5, bottomCable: 16 * 2118 } },
    });
  });

  it('turns a thrown error into a no-convergence result', () => {
    const reply = answer({ id: 2, state: st('s'), resolution: 'full' }, /** @type {any} */ (() => {
      throw new Error('bad matrix');
    }));
    expect(reply.result.status).toBe('no-convergence');
    expect(reply.result.resolution).toBe('full');
    expect(reply.result.diagnostics).toHaveLength(1);
    expect(reply.result.diagnostics[0].code).toBe('no-convergence');
    expect(reply.result.diagnostics[0].message).toContain('bad matrix');
    expect(reply.result.diagnostics[0].message).toBe('The solver stopped with an internal error: bad matrix.');
    expect(reply.result.metrics).toBeNull();
  });

  it('builds a structured-cloneable failed result', () => {
    const r = failedResult('coarse', 'text error');
    expect(structuredClone(r)).toEqual(r);
    expect(r.diagnostics[0].xRange).toBeNull();
  });
});
