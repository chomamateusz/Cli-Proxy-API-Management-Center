import type { EndSourceFixture, WarningFixture } from './fixtures';

export interface CredentialEndSeed {
  name: string;
  provider: 'claude' | 'codex';
  endsAtMs: number | null;
  source: EndSourceFixture | null;
  billingAnchorMs: number | null;
  planActive: boolean;
  warnings: WarningFixture[];
}

interface CredentialEndRecord extends CredentialEndSeed {
  cancelledAtMs: number | null;
}

export type CredentialEndReply = { status: number; body: Record<string, unknown> };

const utcSeconds = (ms: number) =>
  new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

const daysInUtcMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const monthlyOccurrence = (anchorMs: number, monthsAfter: number) => {
  const anchor = new Date(anchorMs);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + monthsAfter;
  const day = Math.min(anchor.getUTCDate(), daysInUtcMonth(year, month));
  return Date.UTC(
    year,
    month,
    day,
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds()
  );
};

export function nextAnniversary(anchorMs: number, afterMs: number): number {
  for (let months = 0; ; months += 1) {
    const occurrence = monthlyOccurrence(anchorMs, months);
    if (occurrence > afterMs) return occurrence;
  }
}

export function createCredentialEndStore(seeds: CredentialEndSeed[], startedAt: number) {
  const records = new Map<string, CredentialEndRecord>(
    seeds.map((seed) => [
      seed.name,
      {
        ...seed,
        endsAtMs:
          seed.source === 'claude-anniversary' && seed.billingAnchorMs !== null
            ? nextAnniversary(seed.billingAnchorMs, startedAt)
            : seed.endsAtMs,
        cancelledAtMs: seed.source === 'claude-anniversary' ? startedAt - 86_400_000 : null,
      },
    ])
  );
  const checkedAtMs = startedAt - 10 * 60 * 1000;

  const clear = (record: CredentialEndRecord) => {
    record.endsAtMs = null;
    record.source = null;
    record.cancelledAtMs = null;
  };

  const stateOf = (record: CredentialEndRecord, nowMs: number) => {
    if (record.endsAtMs === null) return 'none';
    if (record.endsAtMs > nowMs) return 'scheduled';
    if (record.source === 'codex-api' || record.source === 'plan-ended') return 'ended';
    return record.planActive ? 'overdue' : 'ended';
  };

  const warningsOf = (record: CredentialEndRecord) =>
    record.warnings
      .filter((warning) => warning.code !== 'provider_renews' || record.source === 'manual')
      .map((warning) =>
        warning.untilInMs === undefined
          ? { code: warning.code }
          : { code: warning.code, until: utcSeconds(startedAt + warning.untilInMs) }
      );

  const fields = (name: string, nowMs: number) => {
    const record = records.get(name);
    if (!record) return {};
    const state = stateOf(record, nowMs);
    const warnings = warningsOf(record);
    return {
      fleet_end_state: state,
      fleet_end_checked_at: utcSeconds(checkedAtMs),
      ...(record.billingAnchorMs === null
        ? {}
        : { fleet_billing_anchor: new Date(record.billingAnchorMs).toISOString() }),
      ...(warnings.length > 0 ? { fleet_end_warnings: warnings } : {}),
      ...(record.endsAtMs === null
        ? {}
        : {
            fleet_ends_at: utcSeconds(record.endsAtMs),
            fleet_ended: state === 'ended',
            ...(record.source ? { fleet_ends_at_source: record.source } : {}),
            ...(record.cancelledAtMs === null
              ? {}
              : { fleet_cancelled_at: utcSeconds(record.cancelledAtMs) }),
          }),
    };
  };

  const ok = (): CredentialEndReply => ({ status: 200, body: { status: 'ok' } });
  const fail = (error: string, message: string): CredentialEndReply => ({
    status: 400,
    body: { error, message },
  });

  const cancel = (record: CredentialEndRecord, nowMs: number): CredentialEndReply => {
    if (record.provider !== 'claude') {
      return fail('invalid_fleet_cancelled', 'only Claude credentials can be cancelled');
    }
    if (record.billingAnchorMs === null) {
      return fail('no_billing_anchor', 'no subscription_created_at is known for this credential');
    }
    record.endsAtMs = nextAnniversary(record.billingAnchorMs, nowMs);
    record.source = 'claude-anniversary';
    record.cancelledAtMs = nowMs;
    return ok();
  };

  const moveToNextPeriod = (record: CredentialEndRecord): CredentialEndReply => {
    if (record.endsAtMs === null) return fail('invalid_fleet_end_action', 'no end to move');
    if (record.source === 'claude-anniversary' && record.billingAnchorMs !== null) {
      record.endsAtMs = nextAnniversary(record.billingAnchorMs, record.endsAtMs);
      return ok();
    }
    if (record.source === 'manual') {
      record.endsAtMs = monthlyOccurrence(record.endsAtMs, 1);
      return ok();
    }
    return fail('invalid_fleet_end_action', 'only manual or anniversary ends move');
  };

  const patch = (body: Record<string, unknown>, nowMs: number): CredentialEndReply => {
    const name = typeof body.name === 'string' ? body.name : '';
    if (!name) return fail('invalid_body', 'name is required');
    const record = records.get(name);
    if (!record) return { status: 404, body: { error: 'not_found' } };
    if (body.fleet_cancelled === true) return cancel(record, nowMs);
    if (body.fleet_cancelled === false) {
      clear(record);
      return ok();
    }
    if (body.fleet_end_action === 'next_period') return moveToNextPeriod(record);
    if (!('fleet_ends_at' in body)) return ok();
    const value = body.fleet_ends_at;
    if (value === null) {
      clear(record);
      return ok();
    }
    const ms = typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(ms)) {
      return fail('invalid_fleet_ends_at', 'fleet_ends_at must be RFC3339');
    }
    record.endsAtMs = ms;
    record.source = 'manual';
    record.cancelledAtMs = null;
    return ok();
  };

  return { fields, patch };
}
