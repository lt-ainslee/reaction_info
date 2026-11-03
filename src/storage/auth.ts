// Accounts on the server (worker/auth.ts): who is signed in, sign in / up /
// out, password, profile (default visibility of new records) and, for
// admins, the list of accounts. Without the server (local storage) there
// are no accounts: everything stays in this browser.
import { useSyncExternalStore } from 'react';
import type { UserPrefs, Visibility } from './access';
import { clearDraft } from './draft';
import { api, HttpError } from './http';

export interface Account {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'member';
  prefs: UserPrefs;
}

export interface SignedOut {
  /** No account exists yet: the first one becomes the admin. */
  needsSetup: boolean;
  signup: 'open' | 'closed';
}

let me: Account | null = null;
const listeners = new Set<() => void>();
const set = (a: Account | null) => {
  me = a;
  listeners.forEach((f) => f());
};

/** The signed-in account (null when signed out or with local storage). */
export const currentAccount = () => me;

export function useAccount(): Account | null {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => me,
  );
}

/** Who is signed in, or why not. */
export async function fetchMe(): Promise<{ user: Account } | SignedOut> {
  try {
    const { user } = await api<{ user: Account }>('/api/auth/me');
    set(user);
    return { user };
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      set(null);
      return { needsSetup: !!e.body?.needsSetup, signup: e.body?.signup === 'closed' ? 'closed' : 'open' };
    }
    throw e;
  }
}

const post = async (path: string, body: unknown) => {
  const { user } = await api<{ user: Account }>(path, { method: 'POST', body: JSON.stringify(body) });
  set(user);
  return user;
};

export const signIn = (username: string, password: string) => post('/api/auth/login', { username, password });
export const signUp = (username: string, password: string, name: string) => post('/api/auth/register', { username, password, name });
export const setUp = (username: string, password: string, name: string) => post('/api/auth/setup', { username, password, name });

/** Sign out and reload, so nothing of this account stays in the page. */
export async function signOut() {
  try {
    await api<void>('/api/auth/logout', { method: 'POST' });
  } finally {
    // The editor draft belongs to whoever was signed in.
    clearDraft();
    location.reload();
  }
}

export const changePassword = (current: string, password: string) =>
  api<void>('/api/auth/password', { method: 'PUT', body: JSON.stringify({ current, password }) });

export async function updateProfile(p: { name?: string; prefs?: Partial<UserPrefs> }) {
  const { user } = await api<{ user: Account }>('/api/auth/profile', { method: 'PUT', body: JSON.stringify(p) });
  set(user);
  return user;
}

// ---- admin ----

export interface AccountRow {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'member';
  disabled: boolean;
  createdAt: number;
  lastLogin?: number;
  reactions: number;
}

export const listAccounts = () => api<{ users: AccountRow[]; signup: 'open' | 'closed' }>('/api/admin/users');
export const createAccount = (a: { username: string; password: string; name: string; role: 'admin' | 'member' }) =>
  api<{ user: Account }>('/api/admin/users', { method: 'POST', body: JSON.stringify(a) });
export const patchAccount = (id: string, p: { role?: 'admin' | 'member'; disabled?: boolean; password?: string; name?: string }) =>
  api<void>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(p) });
export const setSignup = (signup: 'open' | 'closed') => api<void>('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ signup }) });

export type { Visibility };
