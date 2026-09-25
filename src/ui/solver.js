/**
 * Solver client: sends project states to the solver worker, latest request
 * wins. At most one request is in flight; a newer request while the worker
 * is busy replaces the pending one. Every finished result is delivered, also
 * when a newer request is pending, so a continuous drag still shows results.
 * Without Worker support the solve runs on the main thread in a zero-delay
 * timeout with the same rules.
 * @module ui/solver
 */

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../worker/solver.worker.js').SolveRequest} SolveRequest */
/** @typedef {import('../worker/solver.worker.js').SolveAnswer} SolveAnswer */
/** @typedef {'coarse' | 'full'} Resolution */
/** @typedef {'busy' | 'idle' | 'error'} SolverStatus */

/**
 * @typedef {object} Job
 * @property {number} id
 * @property {ProjectState} state
 * @property {Resolution} resolution
 */

/**
 * @typedef {object} SchedulerHooks
 * @property {(job: Job) => void} send post a job to the worker
 * @property {(job: Job, result: SolveResult) => void} deliver hand a result to the page
 * @property {(status: SolverStatus) => void} status called when the status changes
 */

/**
 * @typedef {object} Scheduler
 * @property {(state: ProjectState, resolution: Resolution) => Job} request queue a
 *   state; sent at once when idle, otherwise it replaces the pending job
 * @property {(id: number, result: SolveResult) => boolean} receive result of
 *   job id; the pending job, if any, is sent first, then the result is
 *   delivered; true when delivered, false when id is not the job in flight
 * @property {(id?: number) => boolean} fail the job in flight (or job id)
 *   failed: nothing is delivered for it, status 'error', then the pending
 *   job is sent; false when id is not the job in flight
 * @property {() => Job | null} inFlight
 * @property {() => Job | null} pending
 * @property {() => SolverStatus} status
 * @property {() => void} clear drop the job in flight and the pending job
 */

/**
 * Latest-wins scheduling of solve requests, without timers or a worker.
 * Status changes: 'busy' when a job is sent from idle or error, 'idle' after
 * a result is delivered and nothing is pending, 'error' when the job in
 * flight fails. While a pending job follows a result the status stays
 * 'busy'.
 * @param {SchedulerHooks} hooks
 * @returns {Scheduler}
 */
export function createScheduler(hooks) {
  let nextId = 1;
  /** @type {Job | null} */
  let inFlight = null;
  /** @type {Job | null} */
  let pending = null;
  /** @type {SolverStatus} */
  let status = 'idle';

  /** @param {SolverStatus} s */
  const setStatus = (s) => {
    if (s === status) return;
    status = s;
    hooks.status(s);
  };

  /** @param {Job} job */
  const send = (job) => {
    inFlight = job;
    setStatus('busy');
    hooks.send(job);
  };

  const sendPending = () => {
    const job = pending;
    pending = null;
    if (job) send(job);
  };

  return {
    request(state, resolution) {
      const job = { id: nextId++, state, resolution: resolution === 'coarse' ? 'coarse' : 'full' };
      if (inFlight) pending = /** @type {Job} */ (job);
      else send(/** @type {Job} */ (job));
      return /** @type {Job} */ (job);
    },
    receive(id, result) {
      if (!inFlight || inFlight.id !== id) return false;
      const job = inFlight;
      inFlight = null;
      // Send the pending job before delivering, so a request made from the
      // deliver hook queues behind it instead of replacing it.
      if (pending) sendPending();
      else setStatus('idle');
      hooks.deliver(job, result);
      return true;
    },
    fail(id) {
      if (!inFlight || (id !== undefined && inFlight.id !== id)) return false;
      inFlight = null;
      setStatus('error');
      sendPending();
      return true;
    },
    inFlight: () => inFlight,
    pending: () => pending,
    status: () => status,
    clear() {
      inFlight = null;
      pending = null;
    },
  };
}

/**
 * @typedef {object} WorkerLike
 * @property {(data: SolveRequest) => void} postMessage
 * @property {() => void} terminate
 * @property {((event: { data: SolveAnswer }) => void) | null} [onmessage]
 * @property {((event: unknown) => void) | null} [onerror]
 * @property {(type: string, fn: (event: any) => void) => void} [addEventListener]
 */

/**
 * @typedef {(request: SolveRequest) => SolveAnswer} AnswerFn
 */

/** The answer function of the worker module, loaded on first use. */
async function loadAnswer() {
  return (await import('../worker/solver.worker.js')).answer;
}

/**
 * Worker stand-in that answers on the main thread in a zero-delay timeout.
 * A request posted before the timeout fires replaces the earlier one, as
 * the scheduler never has two in flight. An error thrown while loading or
 * answering is reported through onerror.
 * @param {() => AnswerFn | Promise<AnswerFn>} [load] returns the answer
 *   function (default: the answer of the worker module, loaded on the first
 *   request)
 * @returns {WorkerLike}
 */
export function createMainThreadWorker(load = loadAnswer) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let closed = false;
  /** @type {AnswerFn | null} */
  let answerFn = null;

  /** @type {WorkerLike} */
  const worker = {
    onmessage: null,
    onerror: null,
    postMessage(data) {
      if (closed) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        try {
          answerFn ??= await load();
          if (closed) return;
          const reply = answerFn(data);
          if (!closed) worker.onmessage?.({ data: reply });
        } catch (error) {
          if (!closed) worker.onerror?.(error);
        }
      }, 0);
    },
    terminate() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
  return worker;
}

/**
 * Default spawn: a module worker, or the main-thread stand-in when Worker
 * is not available or cannot start.
 * @returns {WorkerLike}
 */
export function spawnWorker() {
  if (typeof Worker === 'undefined') return createMainThreadWorker();
  try {
    return /** @type {WorkerLike} */ (/** @type {unknown} */ (
      new Worker(new URL('../worker/solver.worker.js', import.meta.url), { type: 'module' })
    ));
  } catch {
    return createMainThreadWorker();
  }
}

/**
 * @typedef {object} SolverClient
 * @property {(state: ProjectState, resolution: Resolution) => void} request
 *   solve a state; the newest request wins
 * @property {() => void} dispose stop the worker; later requests do nothing
 */

/**
 * Create the solver client.
 * @param {object} options
 * @param {() => WorkerLike} [options.spawn] creates the worker (default
 *   spawnWorker); called again after each worker error
 * @param {(() => WorkerLike) | null} [options.fallback] used instead of
 *   spawn from then on when a worker fails before its first answer, for
 *   example when the browser cannot load a module worker; the job in flight
 *   is sent again to the fallback worker (default: the main-thread stand-in
 *   when spawn is not given, otherwise none)
 * @param {(result: SolveResult, resolution: Resolution, state: ProjectState) => void} options.onResult
 *   a result with the resolution and the state it belongs to
 * @param {(status: SolverStatus) => void} [options.onStatus] 'busy' when a
 *   request is sent, 'idle' after a result is delivered and nothing is
 *   pending, 'error' when the worker fails on a request (and no fallback
 *   takes it over)
 * @returns {SolverClient}
 */
export function createSolver({ spawn, fallback, onResult, onStatus = () => {} }) {
  /** @type {() => WorkerLike} */
  let spawnFn = spawn ?? spawnWorker;
  const backup = fallback === undefined ? (spawn ? null : () => createMainThreadWorker()) : fallback;
  /** @type {WorkerLike | null} */
  let worker = null;
  let disposed = false;
  let onBackup = false;

  /** @param {Job} job */
  const post = (job) => {
    if (!worker) worker = start();
    try {
      worker.postMessage({ id: job.id, state: job.state, resolution: job.resolution });
    } catch {
      // The state cannot be copied to the worker (DataCloneError). The
      // worker itself is fine; report the error so the scheduler does
      // not wait for an answer that never comes.
      scheduler.fail(job.id);
    }
  };

  const scheduler = createScheduler({
    send: post,
    deliver: (job, result) => onResult(result, job.resolution, job.state),
    status: (s) => onStatus(s),
  });

  /** @returns {WorkerLike} */
  function start() {
    const w = spawnFn();
    let answered = false;
    const onError = () => {
      if (w !== worker || disposed) return;
      w.terminate();
      // The next send spawns a fresh worker, so a worker that fails on
      // start does not respawn without a request.
      worker = null;
      // A worker that fails before its first answer most likely cannot
      // start at all; later workers come from the fallback, and the job in
      // flight goes to the fallback with the same id instead of failing.
      if (!answered && backup && !onBackup) {
        spawnFn = backup;
        onBackup = true;
        const job = scheduler.inFlight();
        if (job) {
          post(job);
          return;
        }
      }
      scheduler.fail();
    };
    /** @param {{ data: SolveAnswer }} event */
    const onMessage = (event) => {
      if (w !== worker || disposed) return;
      const data = event.data;
      if (!data || typeof data.id !== 'number') return;
      if (!data.result || typeof data.result !== 'object') {
        onError();
        return;
      }
      answered = true;
      scheduler.receive(data.id, data.result);
    };
    if (typeof w.addEventListener === 'function') {
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      w.addEventListener('messageerror', onError);
    } else {
      w.onmessage = onMessage;
      w.onerror = onError;
    }
    return w;
  }

  return {
    request(state, resolution) {
      if (disposed) return;
      scheduler.request(state, resolution);
    },
    dispose() {
      disposed = true;
      scheduler.clear();
      worker?.terminate();
      worker = null;
    },
  };
}
