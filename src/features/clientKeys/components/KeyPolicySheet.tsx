import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { prefersReducedMotion } from '@/hooks/motion';
import type {
  ClientKeyPolicy,
  ModelCatalog,
  PolicyCredential,
  PolicyListField,
} from '@/types/clientKeys';
import type { PolicyChange } from '../hooks/useClientKeysData';
import { rowReadonlyReason, summarizeRow } from '../matrix';
import { allowsCredential, countModelMatches, policyMatches } from '../policyMatching';
import {
  keyLabelFor,
  patternCellId,
  patternErrors,
  pendingPatternValues,
  queuedPolicyGuardKey,
  type PatternOp,
  type PolicySheetSection,
} from '../presentation';
import { PolicyPatternEditor } from './PolicyPatternEditor';
import styles from './KeyPolicySheet.module.scss';

interface KeyPolicySheetProps {
  open: boolean;
  policy: ClientKeyPolicy | null;
  policies: ClientKeyPolicy[];
  credentials: PolicyCredential[];
  catalog: ModelCatalog;
  focusSection: PolicySheetSection;
  pending: ReadonlyMap<string, unknown>;
  cellErrors: ReadonlyMap<string, string>;
  expiresLabel: string;
  applyPolicyChange: (change: PolicyChange) => boolean;
  dismissCellErrors: (cellIds: string[]) => void;
  onClose: () => void;
}

export function KeyPolicySheet({
  open,
  policy,
  policies,
  credentials,
  catalog,
  focusSection,
  pending,
  cellErrors,
  expiresLabel,
  applyPolicyChange,
  dismissCellErrors,
  onClose,
}: KeyPolicySheetProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const modelsRef = useRef<HTMLHeadingElement | null>(null);
  const credentialsRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Runs after the Sheet's own initial focus, which would otherwise win.
    const timer = window.setTimeout(() => {
      const heading = focusSection === 'models' ? modelsRef.current : credentialsRef.current;
      heading?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
      heading?.focus({ preventScroll: true });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [focusSection, open]);

  if (!policy) return <Sheet open={false} onClose={onClose} />;

  const readonly = rowReadonlyReason(policy, policies);
  const keyLabel = keyLabelFor(t, policy);
  const modelSummary = summarizeRow(policy, catalog);
  const allowedCredentials = credentials.filter((credential) =>
    allowsCredential(policy, credential)
  ).length;
  const modelCandidates = catalog.ids.map((id) => ({ value: id }));
  const credentialCandidates = credentials.map((credential) => ({
    value: credential.writeToken,
    label: credential.displayName,
  }));
  const countModels = (value: string) => countModelMatches(catalog.ids, value);
  const countCredentials = (value: string) =>
    credentials.filter((credential) => policyMatches([value], credential.identityNames).length > 0)
      .length;

  const editor = (field: PolicyListField, labelKey: string, hintKey: string) => {
    const values = policy[field];
    const queued = pendingPatternValues(pending.keys(), policy.name, field);
    const change = (op: PatternOp, value: string): false | Promise<boolean> => {
      let settle: (saved: boolean) => void = () => {};
      const saved = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      const accepted = applyPolicyChange({
        keyName: policy.name,
        cellIds: [patternCellId(policy.name, field, value)],
        patch: op === 'add' ? { add: { [field]: [value] } } : { remove: { [field]: [value] } },
        announce: t(
          op === 'add'
            ? 'client_keys.announce.pattern_added'
            : 'client_keys.announce.pattern_removed',
          { key: keyLabel, value }
        ),
        onSettled: (result) => settle(result),
      });
      return accepted ? saved : false;
    };
    const isModels = field === 'models' || field === 'excludedModels';
    return (
      <PolicyPatternEditor
        id={`${baseId}-${field}-input`}
        label={t(labelKey)}
        hint={t(hintKey)}
        values={values}
        candidates={isModels ? modelCandidates : credentialCandidates}
        matchCount={isModels ? countModels : countCredentials}
        pendingValues={new Set(queued)}
        errors={patternErrors(cellErrors, policy.name, field)}
        disabled={readonly !== null}
        onAdd={(value) => change('add', value)}
        onRemove={(value) => change('remove', value)}
        onDismissError={(value) => dismissCellErrors([patternCellId(policy.name, field, value)])}
        guard={(op, value) => {
          const key = queuedPolicyGuardKey(policy, field, pending.keys(), op, value);
          return key ? t(key) : null;
        }}
      />
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={t('client_keys.sheet.eyebrow')}
      title={keyLabel}
      description={t('client_keys.sheet.description', {
        issuedBy: policy.issuedBy || '—',
        expires: expiresLabel,
      })}
    >
      <div className={styles.body}>
        {readonly ? (
          <div className={styles.notice} role="note">
            {t('client_keys.sheet.readonly_notice', {
              reason: t(`client_keys.matrix.readonly_${readonly}`),
            })}
          </div>
        ) : null}
        <section className={styles.section} aria-labelledby={`${baseId}-models-heading`}>
          <h3
            id={`${baseId}-models-heading`}
            ref={modelsRef}
            tabIndex={-1}
            className={styles.heading}
          >
            {t('client_keys.sheet.models_heading')}
          </h3>
          <p className={styles.summary}>{t('client_keys.sheet.summary_models', modelSummary)}</p>
          {editor(
            'models',
            'client_keys.sheet.allow_models_label',
            'client_keys.sheet.allow_models_hint'
          )}
          {editor(
            'excludedModels',
            'client_keys.sheet.block_models_label',
            'client_keys.sheet.block_models_hint'
          )}
        </section>
        <section className={styles.section} aria-labelledby={`${baseId}-credentials-heading`}>
          <h3
            id={`${baseId}-credentials-heading`}
            ref={credentialsRef}
            tabIndex={-1}
            className={styles.heading}
          >
            {t('client_keys.sheet.credentials_heading')}
          </h3>
          <p className={styles.summary}>
            {t('client_keys.sheet.summary_credentials', {
              allowed: allowedCredentials,
              total: credentials.length,
            })}
          </p>
          {editor(
            'credentials',
            'client_keys.sheet.allow_credentials_label',
            'client_keys.sheet.allow_credentials_hint'
          )}
          {editor(
            'excludedCredentials',
            'client_keys.sheet.block_credentials_label',
            'client_keys.sheet.block_credentials_hint'
          )}
        </section>
      </div>
    </Sheet>
  );
}
