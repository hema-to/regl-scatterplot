import { CATEGORICAL, CONTINUOUS, VALUE_ZW_DATA_TYPES } from './constants.js';

/**
 * Pack the per-point state texture `Float32Array` (x, y, z=value1, w=value2) and derive the
 * texture resolution + z/w data types. Accepts EITHER array-oriented points (`number[][]`, the
 * legacy path) OR a columnar descriptor from `toColumnarPoints` (typed-array accessors, the
 * fast path that avoids the array-of-arrays allocation). The two paths are byte-identical: the
 * `|| 0` coercion, the `Float32Array` narrowing on assignment, and the int-detection that
 * selects `CATEGORICAL`/`CONTINUOUS` all operate on the same fetched values.
 * @param {number[][] | { length: number, getX: (i: number) => number, getY: (i: number) => number, getZ?: (i: number) => number, getW?: (i: number) => number }} newPoints
 * @param {{ z?: string, w?: string }} dataTypes
 * @return {{ data: Float32Array, stateTexRes: number, stateTexEps: number, valueZDataType: string, valueWDataType: string }}
 */
export const createStateTextureData = (newPoints, dataTypes = {}) => {
  const isColumnar = typeof newPoints.getX === 'function';
  const numNewPoints = newPoints.length;
  const stateTexRes = Math.max(2, Math.ceil(Math.sqrt(numNewPoints)));
  const stateTexEps = 0.5 / stateTexRes;
  const data = new Float32Array(stateTexRes ** 2 * 4);

  let zIsInts = true;
  let wIsInts = true;

  let k = 0;
  let z = 0;
  let w = 0;

  if (isColumnar) {
    // Index the x/y typed arrays directly (`newPoints.x`/`y`), not via the `getX`/`getY` closures —
    // one property load hoisted out of the loop instead of 2 function calls per point. Byte-identical:
    // `getX(i)` is defined as `x[i]`. `getZ`/`getW` stay as closures (optional, resolved by name).
    const x = newPoints.x;
    const y = newPoints.y;
    const { getZ, getW } = newPoints;
    for (let i = 0; i < numNewPoints; ++i) {
      k = i * 4;

      data[k] = x[i]; // x
      data[k + 1] = y[i]; // y

      z = (getZ ? getZ(i) : 0) || 0;
      w = (getW ? getW(i) : 0) || 0;

      data[k + 2] = z; // z: value 1
      data[k + 3] = w; // w: value 2
      zIsInts &&= Number.isInteger(z);
      wIsInts &&= Number.isInteger(w);
    }
  } else {
    for (let i = 0; i < numNewPoints; ++i) {
      k = i * 4;

      data[k] = newPoints[i][0]; // x
      data[k + 1] = newPoints[i][1]; // y

      z = newPoints[i][2] || 0;
      w = newPoints[i][3] || 0;

      data[k + 2] = z; // z: value 1
      data[k + 3] = w; // w: value 2
      zIsInts &&= Number.isInteger(z);
      wIsInts &&= Number.isInteger(w);
    }
  }

  let valueZDataType;
  let valueWDataType;

  if (dataTypes.z && VALUE_ZW_DATA_TYPES.includes(dataTypes.z)) {
    valueZDataType = dataTypes.z;
  } else {
    valueZDataType = zIsInts ? CATEGORICAL : CONTINUOUS;
  }

  if (dataTypes.w && VALUE_ZW_DATA_TYPES.includes(dataTypes.w)) {
    valueWDataType = dataTypes.w;
  } else {
    valueWDataType = wIsInts ? CATEGORICAL : CONTINUOUS;
  }

  return { data, stateTexRes, stateTexEps, valueZDataType, valueWDataType };
};
