export interface RevealState {
  revealed: boolean;
  showEmails: boolean;
}

/** The page-wide email switch also takes back every address revealed one by one. */
export const syncRevealState = (state: RevealState, showEmails: boolean): RevealState =>
  state.showEmails === showEmails ? state : { revealed: false, showEmails };
