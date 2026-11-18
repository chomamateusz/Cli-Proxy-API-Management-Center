import { useSyncExternalStore } from 'react';

const subscribe = (listener: () => void) => {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
};

const isVisible = () => document.visibilityState !== 'hidden';
const serverSnapshot = () => false;

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, isVisible, serverSnapshot);
}
