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

export type PatternChangeResult = boolean | Promise<boolean>;

export interface PolicyPatternEditorProps {
  id: string;
  label: string;
  hint: string;
  values: readonly string[];
  candidates: readonly PatternCandidate[];
  matchCount: (value: string) => number;
  pendingValues?: ReadonlySet<string>;
  errors?: ReadonlyMap<string, string>;
  disabled?: boolean;
  onAdd: (value: string) => PatternChangeResult;
  onRemove: (value: string) => PatternChangeResult;
  guard?: (op: PatternOp, value: string) => string | null;
}

interface PendingConfirm {
  op: PatternOp;
  value: string;
  message: string;
}

type FocusRequest =
  | { kind: 'input' }
  | { kind: 'chip'; index: number }
  | { kind: 'after-removal'; value: string; index: number };

export function PolicyPatternEditor({
  id,
  label,
  hint,
  values,
  candidates,
  matchCount,
  pendingValues,
  errors,
  disabled = false,
  onAdd,
  onRemove,
  guard,
}: PolicyPatternEditorProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const dropdownOpenRef = useRef(false);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const focusRequestRef = useRef<FocusRequest | null>(null);
  const known = new Set(candidates.map((candidate) => candidate.value.toLowerCase()));
  const trimmed = input.trim();

  useEffect(() => {
    if (confirm) confirmRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [confirm]);

  useEffect(() => {
    const request = focusRequestRef.current;
    if (!request) return;
    focusRequestRef.current = null;
    const buttons = Array.from(chipsRef.current?.querySelectorAll('button') ?? []);
    const usable = (button: HTMLButtonElement | undefined) =>
      button && !button.disabled ? button : undefined;
    let target: HTMLButtonElement | undefined;
    if (request.kind === 'chip') {
      target = usable(buttons[request.index]);
    } else if (request.kind === 'after-removal') {
      const after = values.includes(request.value) ? request.index + 1 : request.index;
      target =
        buttons.slice(after).find((button) => usable(button)) ??
        buttons
          .slice(0, request.index)
          .reverse()
          .find((button) => usable(button));
    }
    (target ?? document.getElementById(id))?.focus();
  }, [focusTick, id, values]);

  const requestFocus = (request: FocusRequest) => {
    focusRequestRef.current = request;
    setFocusTick((tick) => tick + 1);
  };

  const run = (op: PatternOp, value: string) => {
    setRejected(false);
    if (op === 'add') {
      const result = onAdd(value);
      if (result === false) {
        setRejected(true);
        return;
      }
      void Promise.resolve(result).then((saved) => {
        if (saved) setInput((current) => (current.trim() === value ? '' : current));
      });
      return;
    }
    const index = values.indexOf(value);
    if (onRemove(value) === false) {
      setRejected(true);
      return;
    }
    requestFocus({ kind: 'after-removal', value, index });
  };

  const request = (op: PatternOp, value: string) => {
    const warning = guard?.(op, value) ?? null;
    if (warning) {
      setConfirm({ op, value, message: warning });
      return;
    }
    run(op, value);
  };

  const cancelConfirm = (pendingConfirm: PendingConfirm) => {
    setConfirm(null);
    requestFocus(
      pendingConfirm.op === 'add'
        ? { kind: 'input' }
        : { kind: 'chip', index: values.indexOf(pendingConfirm.value) }
    );
  };

  const applyConfirm = (pendingConfirm: PendingConfirm) => {
    setConfirm(null);
    if (pendingConfirm.op === 'add') requestFocus({ kind: 'input' });
    run(pendingConfirm.op, pendingConfirm.value);
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

  const saveErrors = [
    ...new Set(
      [...(errors ?? [])]
        .filter(([value]) => value === trimmed || values.includes(value))
        .map(([, message]) => message)
    ),
  ];

  return (
    <div className={styles.editor} role="group" aria-label={label}>
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
            setRejected(false);
          }}
          options={[...candidates]}
          placeholder={t('client_keys.sheet.add_placeholder')}
          disabled={disabled}
          hint={hint}
          error={inputError ?? undefined}
          wrapperClassName={styles.input}
          submitOnEnter
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
      {rejected ? <div className="error-box">{t('client_keys.sheet.change_rejected')}</div> : null}
      {saveErrors.map((message) => (
        <div key={message} className="error-box">
          {message}
        </div>
      ))}
      <div ref={chipsRef}>
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
      </div>
      {confirm ? (
        <div
          ref={confirmRef}
          className={styles.confirm}
          role="alert"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            cancelConfirm(confirm);
          }}
        >
          <IconAlertTriangle size={16} className={styles.confirmIcon} />
          <p className={styles.confirmText}>{confirm.message}</p>
          <div className={styles.confirmActions}>
            <Button variant="danger" size="sm" onClick={() => applyConfirm(confirm)}>
              {t('client_keys.sheet.confirm_apply')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => cancelConfirm(confirm)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
