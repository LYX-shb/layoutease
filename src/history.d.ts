export type HistoryChange = { before: string; after: string };
export type ChangeHistory<T extends HistoryChange> = { undo: T[]; redo: T[] };
export type HistoryTransition<T extends HistoryChange> = {
  history: ChangeHistory<T>;
  change: T | null;
};

export function pushHistory<T extends HistoryChange>(
  history: ChangeHistory<T>,
  change: T,
  limit?: number,
): ChangeHistory<T>;
export function undoHistory<T extends HistoryChange>(
  history: ChangeHistory<T>,
  limit?: number,
): HistoryTransition<T>;
export function redoHistory<T extends HistoryChange>(
  history: ChangeHistory<T>,
  limit?: number,
): HistoryTransition<T>;
