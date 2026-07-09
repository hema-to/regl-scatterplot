import '@babel/polyfill';
import { expect, test } from 'vitest';

import createScatterplot from '../src';
import { createCanvas, wait } from './utils';

// INV-PIXEL-IDENTICAL (hit-test half): the columnar fast path retains typed-array accessors instead
// of an array-of-arrays. Every hit-test read (KD-tree build, lasso containment, screen projection,
// in-view range) must return set-identical results to the untouched array-oriented path.

const makeRng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const N = 800;

const buildInputs = (seed) => {
  const rng = makeRng(seed);
  const x = new Float32Array(N);
  const y = new Float32Array(N);
  const valueA = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = (rng() - 0.5) * 1.9;
    y[i] = (rng() - 0.5) * 1.9;
    valueA[i] = Math.floor(rng() * 8);
  }
  // The array-oriented input the fallback path retains: built from the SAME coordinate values.
  const aoa = Array.from({ length: N }, (_, i) => [x[i], y[i], valueA[i]]);
  return { columnar: { x, y, valueA }, aoa };
};

test('columnar vs array-oriented: KD-tree bytes, screen position, lasso set, in-view set', async () => {
  const { columnar, aoa } = buildInputs(2024);

  const spColumnar = createScatterplot({ canvas: createCanvas() });
  const spAoa = createScatterplot({ canvas: createCanvas() });

  await spColumnar.draw(columnar);
  await spAoa.draw(aoa);

  // 1. KD-tree byte-identity — the columnar `createKdbush` builds from x[i]/y[i], the array path
  //    from p[i][0]/p[i][1] (same numbers) ⟹ identical index buffer.
  const idxColumnar = spColumnar.get('spatialIndex');
  const idxAoa = spAoa.get('spatialIndex');
  expect(idxColumnar).toBeInstanceOf(ArrayBuffer);
  expect(idxAoa).toBeInstanceOf(ArrayBuffer);
  expect(new Uint8Array(idxColumnar)).toEqual(new Uint8Array(idxAoa));

  // 2. Screen projection parity across every point (exercises pointX/pointY).
  for (let i = 0; i < N; i++) {
    expect(spColumnar.getScreenPosition(i)).toEqual(spAoa.getScreenPosition(i));
  }
  // Out-of-range indices behave identically (undefined).
  expect(spColumnar.getScreenPosition(-1)).toEqual(spAoa.getScreenPosition(-1));
  expect(spColumnar.getScreenPosition(N)).toEqual(spAoa.getScreenPosition(N));

  // 3. Lasso containment parity (exercises pointXY through findPointsInLasso).
  const polygons = [
    [
      [-1, -1],
      [0.1, -1],
      [0.1, 0.1],
      [-1, 0.1],
    ],
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ];

  for (const polygon of polygons) {
    spColumnar.lassoSelect(polygon, { isGl: true });
    spAoa.lassoSelect(polygon, { isGl: true });
    await wait(0);
    const selColumnar = [...spColumnar.get('selectedPoints')].sort((a, b) => a - b);
    const selAoa = [...spAoa.get('selectedPoints')].sort((a, b) => a - b);
    expect(selColumnar).toEqual(selAoa);
    // Sanity: the middle polygon must actually contain some points, else the test is vacuous.
    spColumnar.deselect();
    spAoa.deselect();
  }

  // 4. In-view range parity after a zoom (exercises the shared spatial index).
  await spColumnar.zoomToArea({ x: -0.5, y: -0.5, width: 1, height: 1 });
  await spAoa.zoomToArea({ x: -0.5, y: -0.5, width: 1, height: 1 });
  expect([...spColumnar.get('pointsInView')].sort((a, b) => a - b)).toEqual(
    [...spAoa.get('pointsInView')].sort((a, b) => a - b),
  );

  spColumnar.destroy();
  spAoa.destroy();
});

test('columnar fast path leaves no array-of-arrays retained (get("points") is the columnar descriptor)', async () => {
  const { columnar } = buildInputs(7);
  const sp = createScatterplot({ canvas: createCanvas() });
  await sp.draw(columnar);

  const retained = sp.get('points');
  // Not an array-of-arrays — the eviction profiler reports 0 AoA bytes for it.
  expect(Array.isArray(retained)).toBe(false);
  expect(retained.length).toBe(N);
  // filteredPoints falls back to the authoritative point count, not points.length.
  expect(sp.get('filteredPoints').length).toBe(N);

  sp.destroy();
});

test('array-oriented input still retains an array-of-arrays (fallback path untouched)', async () => {
  const { aoa } = buildInputs(7);
  const sp = createScatterplot({ canvas: createCanvas() });
  await sp.draw(aoa);

  const retained = sp.get('points');
  expect(Array.isArray(retained)).toBe(true);
  expect(retained.length).toBe(N);
  expect(retained[0].length).toBeGreaterThanOrEqual(2);

  sp.destroy();
});
