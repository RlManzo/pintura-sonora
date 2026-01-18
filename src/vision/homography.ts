export type Pt = { x: number; y: number };

/**
 * Homografía 3x3 (en forma de array de 9 números, row-major):
 * [h00,h01,h02, h10,h11,h12, h20,h21,h22]
 */
export type H = [number, number, number, number, number, number, number, number, number];

/**
 * Calcula una homografía que mapea 4 puntos src -> 4 puntos dst.
 * Usamos DLT con h22 = 1 y resolvemos sistema lineal 8x8.
 */
export function computeHomography4(src: Pt[], dst: Pt[]): H {
  if (src.length !== 4 || dst.length !== 4) throw new Error("Se requieren 4 puntos src y 4 puntos dst");

  // Armamos A * x = b, donde x = [h00,h01,h02,h10,h11,h12,h20,h21]
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const x = src[i].x;
    const y = src[i].y;
    const u = dst[i].x;
    const v = dst[i].y;

    // u = (h00 x + h01 y + h02) / (h20 x + h21 y + 1)
    // v = (h10 x + h11 y + h12) / (h20 x + h21 y + 1)
    // Rearreglo:
    // h00 x + h01 y + h02 - u h20 x - u h21 y = u
    // h10 x + h11 y + h12 - v h20 x - v h21 y = v

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);

    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const x = solveLinearSystem8(A, b); // 8 valores
  const h00 = x[0], h01 = x[1], h02 = x[2];
  const h10 = x[3], h11 = x[4], h12 = x[5];
  const h20 = x[6], h21 = x[7];

  return [h00, h01, h02, h10, h11, h12, h20, h21, 1];
}

/** Aplica homografía H a un punto p. */
export function applyHomography(H: H, p: Pt): Pt {
  const [h00,h01,h02, h10,h11,h12, h20,h21,h22] = H;
  const x = p.x, y = p.y;
  const w = h20 * x + h21 * y + h22;
  return {
    x: (h00 * x + h01 * y + h02) / w,
    y: (h10 * x + h11 * y + h12) / w,
  };
}

/** Inversa de homografía 3x3 */
export function invertHomography(H: H): H {
  const [a,b,c, d,e,f, g,h,i] = H;

  const A = e*i - f*h;
  const B = -(d*i - f*g);
  const C = d*h - e*g;
  const D = -(b*i - c*h);
  const E = a*i - c*g;
  const F = -(a*h - b*g);
  const G = b*f - c*e;
  const Hh = -(a*f - c*d);
  const I = a*e - b*d;

  const det = a*A + b*B + c*C;
  if (Math.abs(det) < 1e-12) throw new Error("Homografía no invertible");

  const invDet = 1 / det;
  return [A*invDet, D*invDet, G*invDet, B*invDet, E*invDet, Hh*invDet, C*invDet, F*invDet, I*invDet];
}

/**
 * Resolver sistema lineal 8x8 con eliminación Gaussiana (A: 8x8, b: 8).
 * (Suficiente para calibración manual.)
 */
function solveLinearSystem8(A: number[][], b: number[]): number[] {
  const n = 8;
  // Matriz aumentada
  const M = A.map((row, r) => [...row, b[r]]);

  for (let col = 0; col < n; col++) {
    // pivot
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error("Sistema singular (calibración inválida)");

    // swap
    if (pivot !== col) {
      const tmp = M[col]; M[col] = M[pivot]; M[pivot] = tmp;
    }

    // normalize pivot row
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;

    // eliminate
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  // solución
  return M.map((row) => row[n]);
}
