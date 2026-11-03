// Who can see and change a record on the server (shared with the Worker: no
// browser deps). Every reaction, reagent lot and abbreviation has an owner
// (the account that created it) and a visibility:
//   private   only the owner sees it
//   shared    everyone signed in sees it (read-only); the owner edits it
//   editable  everyone signed in sees and edits it (group data)
// Records saved before accounts existed have no owner and are "editable".

export const VISIBILITIES = ['private', 'shared', 'editable'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const isVisibility = (v: unknown): v is Visibility => (VISIBILITIES as readonly unknown[]).includes(v);

/** What the server tells the signed-in user about one record. */
export interface Access {
  visibility: Visibility;
  /** Display name of the owner (absent for records from before accounts). */
  ownerName?: string;
  /** Owned by the signed-in user. */
  mine: boolean;
  /** May change the content. */
  canEdit: boolean;
  /** May delete it and change its visibility. */
  canManage: boolean;
}

export interface AccessUser {
  id: string;
  role: 'admin' | 'member';
}

/** The rules, applied by the Worker (owner = user id or null for old records). */
export function accessOf(user: AccessUser, owner: string | null, visibility: string, ownerName?: string | null): Access {
  const vis: Visibility = isVisibility(visibility) ? visibility : 'private';
  const mine = owner !== null && owner === user.id;
  const unowned = owner === null;
  return {
    visibility: vis,
    ...(ownerName ? { ownerName } : {}),
    mine,
    canEdit: mine || unowned || vis === 'editable',
    // Group data from before accounts: an admin looks after it.
    canManage: mine || (unowned && user.role === 'admin'),
  };
}

export const canRead = (user: AccessUser, owner: string | null, visibility: string) =>
  owner === null || owner === user.id || visibility !== 'private';

/** SQL condition for the rows `user` may read (bind: user id). */
export const READABLE_SQL = (ownerCol: string, visCol: string) => `(${ownerCol} IS NULL OR ${ownerCol} = ? OR ${visCol} != 'private')`;

/** Per-user defaults for new records. */
export interface UserPrefs {
  reactions: Visibility;
  lots: Visibility;
  abbrs: Visibility;
}

export const DEFAULT_PREFS: UserPrefs = { reactions: 'private', lots: 'shared', abbrs: 'shared' };

export function normalizePrefs(raw: unknown): UserPrefs {
  const r = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>;
  return {
    reactions: isVisibility(r.reactions) ? r.reactions : DEFAULT_PREFS.reactions,
    lots: isVisibility(r.lots) ? r.lots : DEFAULT_PREFS.lots,
    abbrs: isVisibility(r.abbrs) ? r.abbrs : DEFAULT_PREFS.abbrs,
  };
}
