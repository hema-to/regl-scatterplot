export default () => {
  addEventListener('message', (event) => {
    const { points, columnar, length, nodeSize } = event.data;
    const numPoints = columnar ? length : points.length;

    if (numPoints === 0) {
      self.postMessage({ error: new Error('Invalid point data') });
    }

    const index = new KDBush(numPoints, nodeSize);

    if (columnar) {
      const { x, y } = columnar;
      for (let i = 0; i < numPoints; i++) {
        index.add(x[i], y[i]);
      }
    } else {
      for (const [x, y] of points) {
        index.add(x, y);
      }
    }

    index.finish();

    postMessage(index.data, [index.data]);
  });
};
