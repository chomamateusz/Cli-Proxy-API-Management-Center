import { useId, useState, type ReactNode } from 'react';
import { IconChevronDown } from '@/components/ui/icons';
import styles from './QuotaCardSection.module.scss';

export interface QuotaCardSectionProps {
  title: string;
  summary?: string;
  children: ReactNode;
}

export function QuotaCardSection({ title, summary, children }: QuotaCardSectionProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={styles.section} data-open={open ? 1 : 0}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
      >
        <IconChevronDown size={14} aria-hidden="true" className={styles.chevron} />
        <span className={styles.title}>{title}</span>
        {summary && <span className={styles.summary}>{summary}</span>}
      </button>
      <div id={`${id}-panel`} className={styles.panel} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
