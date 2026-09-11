import type { TokenPair } from '@platform/shared/dto';

/**
 * Tokens live in memory with a sessionStorage mirror so a page reload keeps the session but
 * closing the tab ends it. Nothing else reads storage directly. The tenant app and the platform
 * console each get their own session, so signing into one never grants the other.
 */
export interface Session {
  getTokens(): TokenPair | null;
  getAccessToken(): string | null;
  setTokens(value: TokenPair | null): void;
  clearTokens(): void;
  isAuthenticated(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createSession(storageKey: string): Session {
  let tokens: TokenPair | null = null;
  let read = false;
  const listeners = new Set<() => void>();

  function readStorage(): TokenPair | null {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const raw = sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as TokenPair) : null;
    } catch {
      return null;
    }
  }

  function writeStorage(value: TokenPair | null) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // storage unavailable (private mode); memory copy still works for this page
    }
  }

  const session: Session = {
    getTokens() {
      if (!tokens && !read) {
        tokens = readStorage();
        read = true;
      }
      return tokens;
    },
    getAccessToken() {
      return session.getTokens()?.accessToken ?? null;
    },
    setTokens(value) {
      tokens = value;
      read = true;
      writeStorage(value);
      listeners.forEach((l) => l());
    },
    clearTokens() {
      session.setTokens(null);
    },
    isAuthenticated() {
      return session.getAccessToken() !== null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return session;
}

export const tenantSession = createSession('platform.tokens');
export const adminSession = createSession('platform.admin.tokens');

export const getTokens = () => tenantSession.getTokens();
export const getAccessToken = () => tenantSession.getAccessToken();
export const setTokens = (value: TokenPair | null) => tenantSession.setTokens(value);
export const clearTokens = () => tenantSession.clearTokens();
export const isAuthenticated = () => tenantSession.isAuthenticated();
export const subscribeAuth = (listener: () => void) => tenantSession.subscribe(listener);
