import { useTranslation } from 'react-i18next';
import {
  ExcludedModelChipRow,
  ExcludedModelRuleChip,
} from '@/components/excludedModels/ExcludedModelRuleChip';
import type { PolicyLists } from '@/types/clientKeys';
import { isUnrestrictedAllowlist } from '../policyMatching';

const VISIBLE_EXCLUSIONS = 2;

const variantOf = (value: string) => (value.includes('*') ? 'wildcard' : 'exact');

export function PolicySummary({ lists }: { lists: PolicyLists }) {
  const { t } = useTranslation();
  const credentialRules = [...lists.credentials, ...lists.excludedCredentials];

  const exclusionChips = (values: string[], keyPrefix: string) => {
    const rest = values.slice(VISIBLE_EXCLUSIONS);
    return [
      ...values
        .slice(0, VISIBLE_EXCLUSIONS)
        .map((value, index) => (
          <ExcludedModelRuleChip
            key={`${keyPrefix}-${index}`}
            label={value}
            variant={variantOf(value)}
            title={t('client_keys.policy.blocked_chip_title', { rule: value })}
          />
        )),
      rest.length > 0 ? (
        <ExcludedModelRuleChip
          key={`${keyPrefix}-more`}
          label={t('client_keys.policy.blocked_more', { count: rest.length })}
          variant="unknown"
          title={rest.join(', ')}
        />
      ) : null,
    ];
  };

  return (
    <ExcludedModelChipRow>
      {isUnrestrictedAllowlist(lists.models) ? (
        <ExcludedModelRuleChip label={t('client_keys.policy.all_models')} />
      ) : (
        <ExcludedModelRuleChip
          label={t('client_keys.policy.only_models', { count: lists.models.length })}
          title={lists.models.join(', ')}
        />
      )}
      {exclusionChips(lists.excludedModels, 'model')}
      {credentialRules.length === 0 ? (
        <ExcludedModelRuleChip label={t('client_keys.policy.all_credentials')} />
      ) : (
        <ExcludedModelRuleChip
          label={t('client_keys.policy.credential_rules', { count: credentialRules.length })}
          variant="wildcard"
          title={credentialRules.join(', ')}
        />
      )}
    </ExcludedModelChipRow>
  );
}
