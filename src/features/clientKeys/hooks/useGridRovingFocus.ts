import { useCallback, useState, type FocusEvent, type KeyboardEvent } from 'react';

interface GridPosition {
  row: number;
  col: number;
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

const readPosition = (target: EventTarget): GridPosition | null => {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('td[data-row][data-col]');
  if (!cell) return null;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
};

export function nextGridPosition(
  key: string,
  modifier: boolean,
  from: GridPosition,
  rows: number,
  cols: number
): GridPosition | null {
  const lastRow = rows - 1;
  const lastCol = cols - 1;
  switch (key) {
    case 'ArrowLeft':
      return { row: from.row, col: clamp(from.col - 1, lastCol) };
    case 'ArrowRight':
      return { row: from.row, col: clamp(from.col + 1, lastCol) };
    case 'ArrowUp':
      return { row: clamp(from.row - 1, lastRow), col: from.col };
    case 'ArrowDown':
      return { row: clamp(from.row + 1, lastRow), col: from.col };
    case 'Home':
      return modifier ? { row: 0, col: 0 } : { row: from.row, col: 0 };
    case 'End':
      return modifier ? { row: lastRow, col: lastCol } : { row: from.row, col: lastCol };
    default:
      return null;
  }
}

export function useGridRovingFocus(rows: number, cols: number) {
  const [active, setActive] = useState<GridPosition>({ row: 0, col: 0 });
  const current: GridPosition = {
    row: clamp(active.row, rows - 1),
    col: clamp(active.col, cols - 1),
  };

  const tabIndexFor = (row: number, col: number) =>
    row === current.row && col === current.col ? 0 : -1;

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableElement>) => {
      const from = readPosition(event.target);
      if (!from || rows === 0 || cols === 0) return;
      const next = nextGridPosition(event.key, event.ctrlKey || event.metaKey, from, rows, cols);
      if (!next) return;
      event.preventDefault();
      setActive(next);
      event.currentTarget
        .querySelector<HTMLInputElement>(`td[data-row="${next.row}"][data-col="${next.col}"] input`)
        ?.focus();
    },
    [cols, rows]
  );

  const onFocus = useCallback((event: FocusEvent<HTMLTableElement>) => {
    const position = readPosition(event.target);
    if (position) setActive(position);
  }, []);

  return { tabIndexFor, onKeyDown, onFocus };
}
