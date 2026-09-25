/**
 * Small dense linear algebra on row-major Float64Array matrices: Cholesky
 * factorisation and triangular solves, and Gaussian elimination with
 * partial pivoting. Sizes are small (tens of unknowns), so plain loops are
 * fast enough.
 * @module core/linalg
 */

/**
 * Cholesky factor L (lower triangle, row-major, n×n) of a symmetric
 * positive definite matrix A = L·Lᵀ. Returns null when A is not positive
 * definite to working precision.
 * @param {Float64Array} A row-major n×n, not modified
 * @param {number} n
 * @returns {Float64Array | null}
 */
export function cholesky(A, n) {
  const L = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= L[j * n + k] * L[j * n + k];
    if (!(d > 0) || !Number.isFinite(d)) return null;
    const ljj = Math.sqrt(d);
    L[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = s / ljj;
    }
  }
  return L;
}

/**
 * Solve L·Lᵀ·x = b in place (b becomes x).
 * @param {Float64Array} L Cholesky factor from {@link cholesky}
 * @param {number} n
 * @param {Float64Array} b
 * @returns {Float64Array} b
 */
export function choleskySolve(L, n, b) {
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * b[k];
    b[i] = s / L[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * b[k];
    b[i] = s / L[i * n + i];
  }
  return b;
}

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting. Returns null
 * for a singular matrix.
 * @param {ArrayLike<number>} A row-major n×n, not modified
 * @param {ArrayLike<number>} b not modified
 * @param {number} n
 * @returns {Float64Array | null}
 */
export function solveLinear(A, b, n) {
  const M = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r * n + i]) > Math.abs(M[p * n + i])) p = r;
    if (!(Math.abs(M[p * n + i]) > 0)) return null;
    if (p !== i) {
      for (let c = 0; c < n; c++) {
        const t = M[i * n + c];
        M[i * n + c] = M[p * n + c];
        M[p * n + c] = t;
      }
      const t = x[i];
      x[i] = x[p];
      x[p] = t;
    }
    const piv = M[i * n + i];
    for (let r = i + 1; r < n; r++) {
      const f = M[r * n + i] / piv;
      if (f === 0) continue;
      for (let c = i; c < n; c++) M[r * n + c] -= f * M[i * n + c];
      x[r] -= f * x[i];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let c = i + 1; c < n; c++) s -= M[i * n + c] * x[c];
    x[i] = s / M[i * n + i];
  }
  return x.every(Number.isFinite) ? x : null;
}
