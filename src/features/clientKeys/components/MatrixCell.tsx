import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLock } from '@/components/ui/icons';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { isCellAllowed, type ModelCell } from '../matrix';
import { cellStatePhrase } from '../presentation';
import styles from './ModelMatrix.module.scss';

interface MatrixCellProps {
  row: number;
  col: number;
  keyName: string;
  keyLabel: string;
  modelId: string;
  cell: ModelCell;
  pending: boolean;
  error: string | null;
  tabIndex: number;
  onToggle: (keyName: string, modelId: string, cell: ModelCell) => void;
}

const cellSignature = (cell: ModelCell) => JSON.stringify(cell);

function MatrixCellView({
  row,
  col,
  keyName,
  keyLabel,
  modelId,
  cell,
  pending,
  error,
  tabIndex,
  onToggle,
}: MatrixCellProps) {
  const { t } = useTranslation();
  const phrase = cellStatePhrase(t, cell, pending, error);
  const locked = cell.state === 'locked';
  const className = [
    styles.cell,
    locked && cell.lock.reason === 'pattern' ? styles.cellPattern : '',
    locked && cell.lock.reason !== 'pattern' ? styles.cellMuted : '',
    pending ? styles.cellPending : '',
    error ? styles.cellError : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <td role="gridcell" data-row={row} data-col={col} className={className}>
      <SelectionCheckbox
        checked={isCellAllowed(cell)}
        ariaLabel={`${t('client_keys.matrix.cell_label', { key: keyLabel, model: modelId })}, ${phrase}`}
        title={phrase}
        tabIndex={tabIndex}
        ariaDisabled={locked || pending}
        className={styles.check}
        onChange={() => onToggle(keyName, modelId, cell)}
      />
      {locked ? <IconLock size={10} className={styles.lockIcon} /> : null}
      {cell.state === 'allowed' && cell.unreachable ? (
        <span className={styles.unreachableDot} aria-hidden="true" />
      ) : null}
      {pending ? <span className={`loading-spinner ${styles.spinner}`} aria-hidden="true" /> : null}
    </td>
  );
}

export const MatrixCell = memo(
  MatrixCellView,
  (prev, next) =>
    prev.pending === next.pending &&
    prev.error === next.error &&
    prev.tabIndex === next.tabIndex &&
    prev.row === next.row &&
    prev.col === next.col &&
    prev.keyName === next.keyName &&
    prev.keyLabel === next.keyLabel &&
    prev.modelId === next.modelId &&
    prev.onToggle === next.onToggle &&
    cellSignature(prev.cell) === cellSignature(next.cell)
);
