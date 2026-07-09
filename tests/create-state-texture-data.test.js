import '@babel/polyfill';
import { expect, test } from 'vitest';

import { createStateTextureData } from '../src/create-state-texture-data.js';
import { toArrayOrientedPoints, toColumnarPoints } from '../src/utils.js';

// INV-PIXEL-IDENTICAL: the columnar fast path must pack a state-texture Float32Array (and derive
// the z/w data types) byte-for-byte identically to the untouched array-oriented path. Identical
// texture ⟹ identical GPU pixels. These specs feed the same inputs through both paths and compare
// the raw bytes — no "looks the same", byte comparison only.

// Deterministic PRNG (mulberry32) so a failure is reproducible.
const makeRng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// f32-boundary + edge values the coercion (`|| 0`), narrowing, and int-detection must handle.
const EDGE_VALUES = [
  0,
  -0,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  1,
  -1,
  0.5,
  -0.5,
  16777216, // 2^24, exactly representable f32 int
  16777217, // 2^24 + 1, NOT representable as f32
  3.4028234663852886e38, // f32 max
  1.401298464324817e-45, // f32 min positive denormal
  1.1754943508222875e-38, // f32 min positive normal
  123.456,
  -987.654,
  42,
];

const bytesEqual = (a, b) => {
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (ua.length !== ub.length) return false;
  for (let i = 0; i < ua.length; i++) {
    if (ua[i] !== ub[i]) return false;
  }
  return true;
};

// Wrap raw component arrays into the requested dtype.
const asDtype = (values, dtype) => {
  if (dtype === 'f32') return Float32Array.from(values);
  if (dtype === 'f64') return Float64Array.from(values);
  return [...values]; // plain number[]
};

const buildColumnarInput = (n, components, dtype, rng, useEdges) => {
  const gen = () => {
    const raw = [];
    for (let i = 0; i < n; i++) {
      raw.push(
        useEdges
          ? EDGE_VALUES[Math.floor(rng() * EDGE_VALUES.length)]
          : (rng() - 0.5) * 20,
      );
    }
    return asDtype(raw, dtype);
  };
  const input = { x: gen(), y: gen() };
  if (components >= 3) input.valueA = gen();
  if (components >= 4) input.valueB = gen();
  return input;
};

const assertIdentical = async (input, dataTypes) => {
  const aoa = await toArrayOrientedPoints(input);
  const columnar = toColumnarPoints(input);
  expect(columnar).not.toBeNull();

  const fromAoa = createStateTextureData(aoa, dataTypes);
  const fromColumnar = createStateTextureData(columnar, dataTypes);

  expect(fromColumnar.stateTexRes).toBe(fromAoa.stateTexRes);
  expect(fromColumnar.stateTexEps).toBe(fromAoa.stateTexEps);
  expect(fromColumnar.valueZDataType).toBe(fromAoa.valueZDataType);
  expect(fromColumnar.valueWDataType).toBe(fromAoa.valueWDataType);
  expect(bytesEqual(fromColumnar.data, fromAoa.data)).toBe(true);
};

test('state texture byte-identity: shapes × dtypes × sizes', async () => {
  const rng = makeRng(1337);
  const sizes = [0, 1, 2, 100, 65535, 65536];
  const shapes = [2, 3, 4]; // {x,y}, {x,y,valueA}, {x,y,valueA,valueB}
  const dtypes = ['f32', 'f64', 'plain'];

  for (const n of sizes) {
    for (const components of shapes) {
      for (const dtype of dtypes) {
        const input = buildColumnarInput(n, components, dtype, rng, false);
        await assertIdentical(input, {});
      }
    }
  }
});

test('state texture byte-identity: edge values (0, -0, NaN, ±Inf, f32 boundaries)', async () => {
  const rng = makeRng(98765);
  const sizes = [1, 3, 257, 1024];
  const shapes = [2, 3, 4];
  const dtypes = ['f32', 'f64', 'plain'];

  for (const n of sizes) {
    for (const components of shapes) {
      for (const dtype of dtypes) {
        const input = buildColumnarInput(n, components, dtype, rng, true);
        await assertIdentical(input, {});
      }
    }
  }
});

test('state texture byte-identity: 200k points', async () => {
  const rng = makeRng(424242);
  const input = buildColumnarInput(200000, 4, 'f32', rng, false);
  await assertIdentical(input, {});
});

test('state texture byte-identity: explicit z/w data-type overrides honoured on both paths', async () => {
  const rng = makeRng(555);
  const input = buildColumnarInput(500, 4, 'f64', rng, true);
  await assertIdentical(input, { z: 'continuous', w: 'categorical' });
  await assertIdentical(input, { z: 'categorical', w: 'continuous' });
});
