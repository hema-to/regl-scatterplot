import createKDBushClass from './kdbush-class.js';
import workerFn from './kdbush-worker.js';

const KDBush = createKDBushClass();
const WORKER_THRESHOLD = 1000000;

const createWorker = (fn) => {
  const kdbushStr = createKDBushClass.toString();
  const fnStr = fn.toString();
  const workerStr =
    `const createKDBushClass = ${kdbushStr};` +
    'KDBush = createKDBushClass();' +
    `const createWorker = ${fnStr};` +
    'createWorker();';

  const blob = new Blob([workerStr], { type: 'text/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl, { name: 'KDBush' });

  // Clean up URL
  URL.revokeObjectURL(workerUrl);

  return worker;
};

/**
 * Create KDBush from an either point data or an existing spatial index
 * @param {import('./types').Points | ArrayBuffer} pointsOrIndex - Points or KDBush index
 * @param {Partial<import('./types').CreateKDBushOptions>} options - Options for configuring the index and its creation
 * @return {Promise<KDBush>} KDBush instance
 */
const createKdbush = (
  pointsOrIndex,
  options = { nodeSize: 16, useWorker: undefined },
) =>
  new Promise((resolve, reject) => {
    if (pointsOrIndex instanceof ArrayBuffer) {
      resolve(KDBush.from(pointsOrIndex));
      return;
    }

    // Columnar descriptor (from `toColumnarPoints`): build the index straight from the x/y typed
    // arrays. The coordinates are the same numbers the array-oriented path reads (`p[i][0]`/`[1]`),
    // so the resulting KDBush is byte-identical.
    const isColumnar =
      !Array.isArray(pointsOrIndex) &&
      (Array.isArray(pointsOrIndex.x) || ArrayBuffer.isView(pointsOrIndex.x));

    if (
      (pointsOrIndex.length < WORKER_THRESHOLD ||
        options.useWorker === false) &&
      options.useWorker !== true
    ) {
      const index = new KDBush(pointsOrIndex.length, options.nodeSize);
      if (isColumnar) {
        const { x, y } = pointsOrIndex;
        const n = pointsOrIndex.length;
        for (let i = 0; i < n; i++) {
          index.add(x[i], y[i]);
        }
      } else {
        for (const pointOrIndex of pointsOrIndex) {
          index.add(pointOrIndex[0], pointOrIndex[1]);
        }
      }
      index.finish();
      resolve(index);
    } else {
      const worker = createWorker(workerFn);

      worker.onmessage = (e) => {
        if (e.data.error) {
          reject(e.data.error);
        } else {
          resolve(KDBush.from(e.data));
        }
        worker.terminate();
      };

      if (isColumnar) {
        worker.postMessage({
          columnar: { x: pointsOrIndex.x, y: pointsOrIndex.y },
          length: pointsOrIndex.length,
          nodeSize: options.nodeSize,
        });
      } else {
        worker.postMessage({
          points: pointsOrIndex,
          nodeSize: options.nodeSize,
        });
      }
    }
  });

export const kdbushFrom = (buffer) => KDBush.from(buffer);

export default createKdbush;
