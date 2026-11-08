import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useNow } from '@/hooks/useNow';
import type { IssueKeyInput, IssuedKeySecret } from '@/types/clientKeys';
import { formatRelativeInstant } from '@/utils/quota/relativeTime';
import { classifyClientKeyError, clientKeyErrorMessage } from '../errors';
import { formatKeyInstant } from '../formatInstant';
import { validateKeyName } from '../issueValidation';
import { wildcardMatch } from '../policyMatching';
import { DEFAULT_TTL, TTL_PRESETS, parseTtl, previewExpiry } from '../ttl';
import { IssueKeyReveal, IssueKeyRevealFooter } from './IssueKeyReveal';
import { PolicyPatternEditor } from './PolicyPatternEditor';
import styles from './IssueKeyDialog.module.scss';

export { IssueKeyReveal, IssueKeyRevealFooter } from './IssueKeyReveal';

interface IssueKeyDialogProps {
  open: boolean;
  existingNames: ReadonlySet<string>;
  catalogIds: readonly string[];
  issueKey: (input: IssueKeyInput) => Promise<IssuedKeySecret>;
  onClose: () => void;
}

const NAME_ERRORS = {
  required: 'client_keys.issue.name_required',
  invalid: 'client_keys.issue.name_invalid',
  dots: 'client_keys.issue.name_dots',
  taken: 'client_keys.issue.name_taken',
} as const;

const TTL_ERRORS = {
  empty: 'client_keys.issue.ttl_empty',
  invalid: 'client_keys.issue.ttl_invalid',
  too_short: 'client_keys.issue.ttl_too_short',
  too_long: 'client_keys.issue.ttl_too_long',
} as const;

export function IssueKeyDialog({
  open,
  existingNames,
  catalogIds,
  issueKey,
  onClose,
}: IssueKeyDialogProps) {
  const { t, i18n } = useTranslation();
  const nowMs = useNow();
  const formId = useId();
  const expiryLabelId = useId();
  const nameId = useId();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string>(DEFAULT_TTL);
  const [customTtl, setCustomTtl] = useState('');
  const [ttlError, setTtlError] = useState<string | null>(null);
  const [modelsMode, setModelsMode] = useState<'all' | 'some'>('all');
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const expiryOptions = useMemo(
    () => [
      ...TTL_PRESETS.map((preset) => ({ value: preset.value, label: t(preset.labelKey) })),
      { value: 'custom', label: t('client_keys.issue.expiry_custom') },
      { value: 'never', label: t('client_keys.issue.expiry_never') },
    ],
    [t]
  );
  const ttl = expiry === 'never' ? null : parseTtl(expiry === 'custom' ? customTtl : expiry);
  const candidates = useMemo(() => catalogIds.map((id) => ({ value: id })), [catalogIds]);

  const checkName = (value: string) => {
    const error = validateKeyName(value, existingNames);
    setNameError(error ? t(NAME_ERRORS[error]) : null);
    return error === null;
  };

  useEffect(() => {
    if (!open) return;
    // The Modal focuses its close button on open; move focus to the name field after it.
    const timer = window.setTimeout(() => document.getElementById(nameId)?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [nameId, open]);

  const close = () => {
    setSecret(null);
    onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const nameOk = checkName(name);
    const ttlOk = ttl === null || ttl.ok;
    setTtlError(ttl && !ttl.ok ? t(TTL_ERRORS[ttl.error]) : null);
    const modelsOk = modelsMode === 'all' || models.length > 0;
    setModelsError(modelsOk ? null : t('client_keys.issue.models_required'));
    if (!nameOk || !ttlOk || !modelsOk) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await issueKey({
        name,
        ttl: ttl === null || !ttl.ok ? null : expiry === 'custom' ? ttl.ttl : expiry,
        models: modelsMode === 'all' ? ['*'] : models,
      });
      setSecret(result.secret);
    } catch (err) {
      const classified = classifyClientKeyError(err);
      if (classified.kind === 'name_exists') setNameError(t(NAME_ERRORS.taken));
      else if (classified.kind === 'invalid_ttl' || classified.kind === 'invalid_expiry') {
        setTtlError(clientKeyErrorMessage(t, classified));
      } else setSubmitError(clientKeyErrorMessage(t, classified, { name }));
    } finally {
      setSubmitting(false);
    }
  };

  if (secret !== null) {
    return (
      <Modal
        open={open}
        title={t('client_keys.issue.success_title')}
        onClose={close}
        width={560}
        closeDisabled={!acknowledged}
        footer={<IssueKeyRevealFooter acknowledged={acknowledged} onDone={close} />}
      >
        <IssueKeyReveal
          secret={secret}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={t('client_keys.issue.title')}
      onClose={close}
      width={560}
      closeDisabled={submitting}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={submitting}>
            {t('client_keys.issue.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <Input
          label={t('client_keys.issue.name_label')}
          hint={t('client_keys.issue.name_hint')}
          value={name}
          error={nameError ?? undefined}
          id={nameId}
          spellCheck={false}
          autoComplete="off"
          className={styles.mono}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(null);
          }}
          onBlur={() => {
            if (name !== '') checkName(name);
          }}
        />
        <div className="form-group">
          <label id={expiryLabelId}>{t('client_keys.issue.expiry_label')}</label>
          <Select
            value={expiry}
            options={expiryOptions}
            onChange={(value) => {
              setExpiry(value);
              setTtlError(null);
            }}
            ariaLabelledBy={expiryLabelId}
          />
        </div>
        {expiry === 'custom' ? (
          <Input
            label={t('client_keys.issue.custom_label')}
            hint={t('client_keys.issue.custom_hint')}
            value={customTtl}
            error={ttlError ?? undefined}
            onChange={(event) => {
              setCustomTtl(event.target.value);
              setTtlError(null);
            }}
            onBlur={() => {
              const parsed = parseTtl(customTtl);
              setTtlError(parsed.ok ? null : t(TTL_ERRORS[parsed.error]));
            }}
          />
        ) : null}
        {expiry !== 'custom' && ttlError ? <div className="error-box">{ttlError}</div> : null}
        {expiry === 'never' ? (
          <div className={styles.warning}>
            <p>{t('client_keys.issue.never_warning')}</p>
          </div>
        ) : null}
        {ttl?.ok ? (
          <p className={styles.preview}>
            {t('client_keys.issue.expiry_preview', {
              date: formatKeyInstant(previewExpiry(ttl.ms, nowMs), i18n.language),
              relative: formatRelativeInstant(previewExpiry(ttl.ms, nowMs), nowMs, i18n.language),
            })}
          </p>
        ) : null}
        <fieldset className={styles.fieldset}>
          <legend>{t('client_keys.issue.models_label')}</legend>
          {(['all', 'some'] as const).map((mode) => (
            <label key={mode} className={styles.radio}>
              <input
                type="radio"
                name={`${formId}-models`}
                checked={modelsMode === mode}
                onChange={() => {
                  setModelsMode(mode);
                  setModelsError(null);
                }}
              />
              {t(mode === 'all' ? 'client_keys.issue.models_all' : 'client_keys.issue.models_some')}
            </label>
          ))}
        </fieldset>
        {submitError ? <div className="error-box">{submitError}</div> : null}
      </form>
      {modelsMode === 'some' ? (
        <div className={styles.modelsEditor}>
          <PolicyPatternEditor
            id={`${formId}-models-editor`}
            label={t('client_keys.sheet.allow_models_label')}
            hint={t('client_keys.sheet.allow_models_hint')}
            values={models}
            candidates={candidates}
            matchCount={(value) => catalogIds.filter((id) => wildcardMatch(value, id)).length}
            onAdd={(value) => {
              setModels((current) => [...current, value]);
              setModelsError(null);
            }}
            onRemove={(value) => setModels((current) => current.filter((item) => item !== value))}
          />
          {modelsError ? <div className="error-box">{modelsError}</div> : null}
        </div>
      ) : null}
    </Modal>
  );
}
