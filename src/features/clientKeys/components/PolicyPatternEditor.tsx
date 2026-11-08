import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExcludedModelChipRow,
  ExcludedModelRuleChip,
} from '@/components/excludedModels/ExcludedModelRuleChip';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { Button } from '@/components/ui/Button';
import { IconAlertTriangle, IconPlus } from '@/components/ui/icons';
import type { PatternOp } from '../presentation';
import styles from './PolicyPatternEditor.module.scss';

export interface PatternCandidate {
  value: string;
  label?: string;
}

export interface PolicyPatternEditorProps {
  id: string;
  label: string;
  hint: string;
  values: readonly string[];
  candidates: readonly PatternCandidate[];
  matchCount: (value: string) => number;
  pendingValues?: ReadonlySet<string>;
  disabled?: boolean;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  guard?: (op: PatternOp, value: string) => string | null;
}

interface PendingConfirm {
  op: PatternOp;
  value: string;
  message: string;
}

export function PolicyPatternEditor({
  id,
  label,
  hint,
  values,
  candidates,
  matchCount,
  pendingValues,
  disabled = false,
  onAdd,
  onRemove,
  guard,
}: PolicyPatternEditorProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const dropdownOpenRef = useRef(false);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const known = new Set(candidates.map((candidate) => candidate.value.toLowerCase()));
  const trimmed = input.trim();

  useEffect(() => {
    if (confirm) confirmRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [confirm]);

  const run = (op: PatternOp, value: string) => {
    if (op === 'add') {
      onAdd(value);
      setInput('');
    } else {
      onRemove(value);
    }
  };

  const request = (op: PatternOp, value: string) => {
    const warning = guard?.(op, value) ?? null;
    if (warning) {
      setConfirm({ op, value, message: warning });
      return;
    }
    run(op, value);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    if (!trimmed) {
      setInputError(t('client_keys.sheet.empty_value'));
      return;
    }
    if (values.some((value) => value.toLowerCase() === trimmed.toLowerCase())) {
      setInputError(t('client_keys.sheet.duplicate_entry'));
      return;
    }
    setInputError(null);
    request('add', trimmed);
  };

  const hasVisibleOptions = () => {
    const query = input.toLowerCase();
    return candidates.some(
      (candidate) =>
        candidate.value.toLowerCase().includes(query) ||
        Boolean(candidate.label?.toLowerCase().includes(query))
    );
  };

  // AutocompleteInput closes its dropdown on Escape but lets the key reach the Sheet's document
  // listener, which would close the whole sheet; consume it while there is something to dismiss.
  const handleInputKeys = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      if (dropdownOpenRef.current && hasVisibleOptions()) {
        event.stopPropagation();
      } else if (input !== '') {
        event.stopPropagation();
        setInput('');
        setInputError(null);
      }
      dropdownOpenRef.current = false;
      return;
    }
    dropdownOpenRef.current = event.key !== 'Tab' && event.key !== 'Enter';
  };

  const chipDetail = (value: string, variant: 'exact' | 'wildcard' | 'unknown') => {
    if (pendingValues?.has(value)) return t('client_keys.sheet.saving');
    if (variant === 'unknown') return t('client_keys.sheet.unknown_entry');
    if (variant === 'exact') return undefined;
    const count = matchCount(value);
    return count === 0
      ? t('client_keys.sheet.matches_none')
      : t('client_keys.sheet.matches', { count });
  };

  return (
    <div className={styles.editor} role="group" aria-label={label}>
      <ExcludedModelChipRow>
        {values.map((value) => {
          const variant = value.includes('*')
            ? 'wildcard'
            : known.has(value.toLowerCase())
              ? 'exact'
              : 'unknown';
          return (
            <ExcludedModelRuleChip
              key={value}
              label={value}
              variant={variant}
              detail={chipDetail(value, variant)}
              onRemove={disabled ? undefined : () => request('remove', value)}
              removeAriaLabel={t('client_keys.sheet.remove_aria', { value })}
              disabled={pendingValues?.has(value) || confirm !== null}
            />
          );
        })}
      </ExcludedModelChipRow>
      {confirm ? (
        <div
          ref={confirmRef}
          className={styles.confirm}
          role="alert"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setConfirm(null);
          }}
        >
          <IconAlertTriangle size={16} className={styles.confirmIcon} />
          <p className={styles.confirmText}>{confirm.message}</p>
          <div className={styles.confirmActions}>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                const { op, value } = confirm;
                setConfirm(null);
                run(op, value);
              }}
            >
              {t('client_keys.sheet.confirm_apply')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      <form
        className={styles.addRow}
        onSubmit={submit}
        onKeyDown={handleInputKeys}
        onFocus={() => {
          dropdownOpenRef.current = true;
        }}
      >
        <AutocompleteInput
          id={id}
          label={label}
          value={input}
          onChange={(next) => {
            setInput(next);
            setInputError(null);
          }}
          options={[...candidates]}
          placeholder={t('client_keys.sheet.add_placeholder')}
          disabled={disabled}
          hint={hint}
          error={inputError ?? undefined}
          wrapperClassName={styles.input}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={disabled}>
          <span className={styles.buttonContent}>
            <IconPlus size={14} />
            {t('client_keys.sheet.add')}
          </span>
        </Button>
      </form>
      {trimmed && !disabled ? (
        <p className={styles.live} aria-live="polite">
          {matchCount(trimmed) === 0
            ? t('client_keys.sheet.matches_none')
            : t('client_keys.sheet.matches', { count: matchCount(trimmed) })}
        </p>
      ) : null}
    </div>
  );
}
