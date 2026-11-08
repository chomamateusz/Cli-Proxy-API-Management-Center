import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { prefersReducedMotion } from '@/hooks/motion';
import {
  CLIENT_KEYS_VIEWS,
  clientKeysPanelId,
  clientKeysTabId,
  type ClientKeysView,
} from '../presentation';
import styles from './ClientKeysTabs.module.scss';

interface ClientKeysTabsProps {
  active: ClientKeysView;
  keyCount: number | null;
  onChange: (view: ClientKeysView) => void;
}

export function ClientKeysTabs({ active, keyCount, onChange }: ClientKeysTabsProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Partial<Record<ClientKeysView, HTMLButtonElement | null>>>({});

  useEffect(() => {
    const scroller = listRef.current;
    const button = buttonRefs.current[active];
    if (!scroller || !button || scroller.scrollWidth <= scroller.clientWidth) return;
    button.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [active]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const count = CLIENT_KEYS_VIEWS.length;
    const index = CLIENT_KEYS_VIEWS.indexOf(active);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % count;
    else if (event.key === 'ArrowLeft') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next < 0) return;
    event.preventDefault();
    const view = CLIENT_KEYS_VIEWS[next];
    onChange(view);
    buttonRefs.current[view]?.focus();
  };

  const labelFor = (view: ClientKeysView) =>
    view === 'keys' && keyCount !== null
      ? t('client_keys.tabs.keys_count', { count: keyCount })
      : t(`client_keys.tabs.${view}`);

  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label={t('client_keys.tabs.label')}
      ref={listRef}
    >
      {CLIENT_KEYS_VIEWS.map((view) => {
        const isActive = view === active;
        return (
          <button
            key={view}
            ref={(node) => {
              buttonRefs.current[view] = node;
            }}
            type="button"
            role="tab"
            id={clientKeysTabId(view)}
            aria-selected={isActive}
            aria-controls={clientKeysPanelId(view)}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            onClick={() => onChange(view)}
            onKeyDown={handleKeyDown}
          >
            {labelFor(view)}
          </button>
        );
      })}
    </div>
  );
}
