// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { addComponent, emptyReaction, newComponent, REACTION_SCHEMA, type Reaction } from '../chem/stoich';
import { loadDraft, saveDraft } from './draft';
import { reactionFromFile, reactionToFile } from './files';
import { newId } from './ids';
import { localRepo } from './localRepo';
import { normalizeReaction } from './schema';
import { ConflictError, NotFoundError } from './types';

const sample = (title = 'Test'): Reaction => ({
  ...addComponent(emptyReaction(), newComponent({ name: 'A', role: 'reactant', mw: 100 })),
  title,
});

beforeEach(() => localStorage.clear());

describe('ids', () => {
  it('are UUID v4 and unique', () => {
    const a = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(Array.from({ length: 1000 }, newId)).size).toBe(1000);
  });
});

describe('normalizeReaction', () => {
  it('stamps the schema version and keeps valid data as is', () => {
    const r = sample();
    expect(normalizeReaction(r)).toEqual({ ...r, schemaVersion: REACTION_SCHEMA });
  });

  it('repairs legacy / partial data', () => {
    const r = normalizeReaction({
      refMmol: -1,
      refId: 'gone',
      components: [{ name: 'X', role: 'catalyst' }],
    })!;
    expect(r.title).toBe('');
    expect(r.refMmol).toBe(1);
    expect(r.refId).toBeNull();
    expect(r.components[0]).toMatchObject({ form: 'neat', purity: 100, equiv: 0.05 });
    expect(r.components[0].id).toBeTruthy();
  });

  it('rejects non-reactions', () => {
    expect(normalizeReaction(null)).toBeNull();
    expect(normalizeReaction({ components: 'x' })).toBeNull();
    expect(normalizeReaction({ components: [{ name: 'X', role: 'wizard' }] })).toBeNull();
  });
});

describe('localRepo', () => {
  it('creates, lists (newest first, without bodies) and gets', async () => {
    const a = await localRepo.create(sample('A'));
    const b = await localRepo.create(sample('B'));
    expect(a.version).toBe(1);
    const list = await localRepo.list();
    expect(list.map((s) => s.title)).toEqual(['B', 'A']);
    expect(list[0]).not.toHaveProperty('reaction');
    expect((await localRepo.get(a.id))?.reaction.title).toBe('A');
    expect(await localRepo.get('nope')).toBeNull();
    expect(b.id).not.toBe(a.id);
  });

  it('bumps the version on update and detects conflicts', async () => {
    const a = await localRepo.create(sample('A'));
    const a2 = await localRepo.update(a.id, sample('A2'), 1);
    expect(a2.version).toBe(2);
    expect(a2.title).toBe('A2');
    // A second window still holding version 1:
    await expect(localRepo.update(a.id, sample('stale'), 1)).rejects.toBeInstanceOf(ConflictError);
    await expect(localRepo.update(a.id, sample('stale'), 1)).rejects.toMatchObject({ current: { version: 2 } });
    await expect(localRepo.update('missing', sample(), 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('removes', async () => {
    const a = await localRepo.create(sample('A'));
    await localRepo.remove(a.id);
    expect(await localRepo.list()).toEqual([]);
  });

  it('migrates the v1 format without deleting it', async () => {
    const legacy = [{ id: 'abc12345', savedAt: 1700000000000, reaction: sample('Old') }];
    localStorage.setItem('saved-reactions-v1', JSON.stringify(legacy));
    const list = await localRepo.list();
    expect(list).toEqual([{ id: 'abc12345', title: 'Old', updatedAt: 1700000000000, version: 1 }]);
    expect(localStorage.getItem('saved-reactions-v1')).not.toBeNull();
    // Later writes go to v2 only.
    await localRepo.update('abc12345', sample('Old 2'), 1);
    expect(JSON.parse(localStorage.getItem('saved-reactions-v1')!)[0].reaction.title).toBe('Old');
    expect((await localRepo.get('abc12345'))?.version).toBe(2);
  });

  it('skips corrupt entries instead of failing', async () => {
    localStorage.setItem('saved-reactions-v2', JSON.stringify([{ id: 'x', reaction: { components: 'bad' } }, null]));
    expect(await localRepo.list()).toEqual([]);
  });
});

describe('draft', () => {
  it('round-trips and normalizes', () => {
    saveDraft(sample('D'));
    expect(loadDraft()).toMatchObject({ title: 'D', schemaVersion: REACTION_SCHEMA });
    localStorage.setItem('current-reaction-v1', '{broken');
    expect(loadDraft()).toBeNull();
  });
});

describe('reaction files', () => {
  it('round-trips a reaction', () => {
    const r = sample();
    expect(reactionFromFile(reactionToFile(r))).toEqual({ ...r, schemaVersion: REACTION_SCHEMA });
  });

  it('rejects other JSON and garbage', () => {
    expect(reactionFromFile('{"foo":1}')).toBeNull();
    expect(reactionFromFile('{"app":"reaction-info","reaction":{"components":"x"}}')).toBeNull();
    expect(reactionFromFile('not json')).toBeNull();
  });
});
