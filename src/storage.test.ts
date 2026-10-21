import { describe, expect, it } from 'vitest';
import { addComponent, emptyReaction, newComponent } from './chem/stoich';
import { reactionFromFile, reactionToFile } from './storage';

describe('reaction files', () => {
  it('round-trips a reaction', () => {
    const r = { ...addComponent(emptyReaction(), newComponent({ name: 'A', role: 'reactant', mw: 100 })), title: 'Test' };
    expect(reactionFromFile(reactionToFile(r))).toEqual(r);
  });

  it('rejects other JSON and garbage', () => {
    expect(reactionFromFile('{"foo":1}')).toBeNull();
    expect(reactionFromFile('{"app":"reaction-info","reaction":{"components":"x"}}')).toBeNull();
    expect(reactionFromFile('not json')).toBeNull();
  });
});
