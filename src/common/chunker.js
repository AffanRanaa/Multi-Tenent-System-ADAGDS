'use strict';

/**
 * Splits a dataset across a number of workloads — the core of "split a dataset
 * across N apps". Pure function, so it is fully unit-testable.
 *
 * Produces exactly `count` contiguous chunks (or fewer if there are fewer
 * records than `count`), each as evenly sized as possible.
 *
 * @param {Array} items the dataset records
 * @param {number} count desired number of chunks
 * @returns {Array[]} array of chunks
 */
function splitIntoChunks(items, count) {
  const total = items.length;
  if (total === 0) return [];

  const chunkCount = Math.max(1, Math.min(Math.floor(count), total));
  const baseSize = Math.floor(total / chunkCount);
  const remainder = total % chunkCount;

  const chunks = [];
  let start = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    // The first `remainder` chunks take one extra record to stay balanced.
    const size = baseSize + (index < remainder ? 1 : 0);
    chunks.push(items.slice(start, start + size));
    start += size;
  }
  return chunks;
}

module.exports = { splitIntoChunks };
