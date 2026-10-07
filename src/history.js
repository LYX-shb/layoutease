export function pushHistory(history, change, limit = 100) {
  if (change.before === change.after) return history;
  return {
    undo: [...history.undo, change].slice(-limit),
    redo: [],
  };
}

export function undoHistory(history, limit = 100) {
  const change = history.undo[history.undo.length - 1];
  if (!change) return { history, change: null };
  return {
    history: {
      undo: history.undo.slice(0, -1),
      redo: [...history.redo, change].slice(-limit),
    },
    change,
  };
}

export function redoHistory(history, limit = 100) {
  const change = history.redo[history.redo.length - 1];
  if (!change) return { history, change: null };
  return {
    history: {
      undo: [...history.undo, change].slice(-limit),
      redo: history.redo.slice(0, -1),
    },
    change,
  };
}
