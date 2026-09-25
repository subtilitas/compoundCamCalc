/**
 * Numerical helpers for the verification tests: Gauss–Legendre quadrature,
 * central differences and a small dense linear solver. Independent of the
 * model code.
 */

/**
 * Nodes and weights of the n-point Gauss–Legendre rule on [−1, 1], by
 * Newton iteration on the Legendre polynomial P_n.
 * @param {number} n
 * @returns {{ nodes: Float64Array, weights: Float64Array }}
 */
export function gaussLegendre(n) {
  const nodes = new Float64Array(n);
  const weights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-16) break;
    }
    nodes[i] = x;
    weights[i] = 2 / ((1 - x * x) * dp * dp);
  }
  return { nodes, weights };
}

const rule = gaussLegendre(20);

/**
 * Composite 20-point Gauss–Legendre integral of f over [a, b].
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {number} [panels=16]
 */
export function integrate(f, a, b, panels = 16) {
  let sum = 0;
  const h = (b - a) / panels;
  for (let k = 0; k < panels; k++) {
    const mid = a + (k + 0.5) * h;
    let part = 0;
    for (let i = 0; i < rule.nodes.length; i++) part += rule.weights[i] * f(mid + 0.5 * h * rule.nodes[i]);
    sum += 0.5 * h * part;
  }
  return sum;
}

/**
 * Fourth-order central difference of f at x.
 * @param {(x: number) => number} f
 * @param {number} x
 * @param {number} h
 */
export function derivative(f, x, h) {
  return (8 * (f(x + h) - f(x - h)) - (f(x + 2 * h) - f(x - 2 * h))) / (12 * h);
}

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting.
 * @param {number[][]} matrix square, not modified
 * @param {number[]} rhs not modified
 * @returns {number[]}
 */
export function solveDense(matrix, rhs) {
  const A = matrix.map((row) => [...row]);
  const b = [...rhs];
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}
