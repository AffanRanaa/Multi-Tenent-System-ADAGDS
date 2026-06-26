'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { splitIntoChunks } = require('../../src/common/chunker');

function range(n) {
  return Array.from({ length: n }, (_, i) => i + 1);
}

test('splits a dataset into the requested number of chunks', () => {
  const chunks = splitIntoChunks(range(100), 4);
  assert.strictEqual(chunks.length, 4);
  assert.deepStrictEqual(chunks.map((c) => c.length), [25, 25, 25, 25]);
});

test('distributes the remainder evenly across the first chunks', () => {
  const chunks = splitIntoChunks(range(10), 3);
  assert.strictEqual(chunks.length, 3);
  assert.deepStrictEqual(chunks.map((c) => c.length), [4, 3, 3]);
});

test('every record appears exactly once, in order', () => {
  const chunks = splitIntoChunks(range(6348), 10);
  const flat = chunks.flat();
  assert.strictEqual(flat.length, 6348);
  assert.deepStrictEqual(flat, range(6348));
});

test('never produces more chunks than records', () => {
  const chunks = splitIntoChunks(range(3), 20);
  assert.strictEqual(chunks.length, 3);
});

test('handles an empty dataset', () => {
  assert.deepStrictEqual(splitIntoChunks([], 5), []);
});

test('a count of one yields a single chunk with everything', () => {
  const chunks = splitIntoChunks(range(50), 1);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].length, 50);
});
