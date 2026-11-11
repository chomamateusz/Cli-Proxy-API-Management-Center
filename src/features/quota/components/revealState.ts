export interface RevealState {
  revealed: boolean;
  showEmails: boolean;
}

export const syncRevealState = (state: RevealState, showEmails: boolean): RevealState =>
  state.showEmails === showEmails ? state : { revealed: false, showEmails };
