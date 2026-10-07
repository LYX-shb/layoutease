const assert = require('node:assert/strict');
const { test } = require('node:test');

const historyModule = import('../src/history.js');

test('history supports ten undo/redo steps and clears redo after a new edit', async () => {
  const { pushHistory, undoHistory, redoHistory } = await historyModule;
  const changes = Array.from({ length: 10 }, (_, index) => ({
    id: 'title',
    kind: 'style',
    property: 'fontSize',
    before: String(index),
    after: String(index + 1),
  }));

  let history = { undo: [], redo: [] };
  for (const change of changes) history = pushHistory(history, change);
  assert.equal(history.undo.length, 10);
  assert.equal(history.redo.length, 0);

  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const transition = undoHistory(history);
    assert.deepEqual(transition.change, changes[index]);
    history = transition.history;
  }
  assert.equal(history.undo.length, 0);
  assert.equal(history.redo.length, 10);
  assert.equal(undoHistory(history).change, null);

  for (let index = 0; index < changes.length; index += 1) {
    const transition = redoHistory(history);
    assert.deepEqual(transition.change, changes[index]);
    history = transition.history;
  }
  assert.equal(history.undo.length, 10);
  assert.equal(history.redo.length, 0);
  assert.equal(redoHistory(history).change, null);

  history = undoHistory(history).history;
  history = pushHistory(history, { id: 'title', kind: 'text', before: 'old', after: 'new' });
  assert.equal(history.redo.length, 0, 'a new edit discards the redo branch');
});

test('history ignores no-op changes and keeps only the latest 100 entries', async () => {
  const { pushHistory } = await historyModule;
  let history = { undo: [], redo: [] };
  history = pushHistory(history, { id: 'text', kind: 'text', before: 'same', after: 'same' });
  assert.equal(history.undo.length, 0);

  for (let index = 0; index < 105; index += 1) {
    history = pushHistory(history, { id: 'text', kind: 'text', before: String(index), after: String(index + 1) });
  }
  assert.equal(history.undo.length, 100);
  assert.equal(history.undo[0].before, '5');
  assert.equal(history.undo[99].after, '105');
});
