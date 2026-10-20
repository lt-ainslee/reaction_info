import { describe, expect, it } from 'vitest';
import { splitNameReaction, splitReactionSmiles } from './resolve';

describe('reaction parsing', () => {
  it('splits reaction SMILES with agents and grouped salts', () => {
    expect(splitReactionSmiles('c1ccccc1Br.OB(O)c1ccccc1>(O=C([O-])[O-].[K+].[K+])>c1ccc(cc1)-c1ccccc1')).toEqual({
      reactants: ['c1ccccc1Br', 'OB(O)c1ccccc1'],
      agents: ['O=C([O-])[O-].[K+].[K+]'],
      products: ['c1ccc(cc1)-c1ccccc1'],
    });
    expect(splitReactionSmiles('CCO>>CC=O')?.agents).toEqual([]);
    expect(splitReactionSmiles('CCO')).toBeNull();
  });

  it('splits name reactions', () => {
    expect(splitNameReaction('苯甲酸 + 甲醇 -> 苯甲酸甲酯')).toEqual({ reactants: ['苯甲酸', '甲醇'], products: ['苯甲酸甲酯'] });
    expect(splitNameReaction('benzoic acid + methanol → methyl benzoate + water')?.products).toEqual(['methyl benzoate', 'water']);
    expect(splitNameReaction('no arrow here')).toBeNull();
  });
});
