import type { AuthFileItem } from '@/types';
import type {
  CancelCredentialOutcome,
  CredentialEndActions,
} from './components/CredentialEndControl';

export interface CredentialEndActionDeps {
  patchEnd: (name: string, fleetEndsAt: string | null) => Promise<unknown>;
  markCancelled: (name: string) => Promise<CancelCredentialOutcome>;
  moveEndToNextPeriod: (name: string) => Promise<unknown>;
  reload: () => Promise<boolean>;
  notify: (key: string, name: string) => void;
  sameSession: () => boolean;
  applyLocalEnd: (name: string, fleetEndsAt: string | null) => void;
  endsMovedToNextPeriod: Map<string, string | undefined>;
}

export function createCredentialEndActions(deps: CredentialEndActionDeps): CredentialEndActions {
  const { endsMovedToNextPeriod: movedEnds } = deps;
  const reloadInSession = async () => {
    if (deps.sameSession()) await deps.reload();
  };
  const wasAlreadyMoved = (file: AuthFileItem) =>
    movedEnds.has(file.name) && movedEnds.get(file.name) === file.fleetEndsAt;

  return {
    save: async (file, fleetEndsAt) => {
      await deps.patchEnd(file.name, fleetEndsAt);
      if (!deps.sameSession()) return;
      deps.applyLocalEnd(file.name, fleetEndsAt);
      deps.notify(
        fleetEndsAt === null ? 'credential_end.cleared' : 'credential_end.saved',
        file.name
      );
      void deps.reload();
    },
    cancel: async (file) => {
      const outcome = await deps.markCancelled(file.name);
      if (outcome === 'scheduled' && deps.sameSession()) {
        deps.notify('credential_end.cancel_saved', file.name);
        await reloadInSession();
      }
      return outcome;
    },
    nextPeriod: async (file) => {
      if (!wasAlreadyMoved(file)) {
        await deps.moveEndToNextPeriod(file.name);
        movedEnds.set(file.name, file.fleetEndsAt);
        if (deps.sameSession()) deps.notify('credential_end.next_period_saved', file.name);
      }
      await reloadInSession();
    },
  };
}
