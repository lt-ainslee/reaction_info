// Tiptap extension: formula subscripts, "[M+H]+" charges and symbol shortcuts
// while typing. Each conversion is one undo step (Backspace right after it
// restores what was typed).
import { Extension, InputRule } from '@tiptap/core';
import { CHARGE_FIND, FORMULA_FIND, formulaSubscripts, SYMBOL_RULES } from './chemText';

export const ChemTypography = Extension.create({
  name: 'chemTypography',

  addInputRules() {
    const formula = new InputRule({
      find: FORMULA_FIND,
      handler: ({ state, range, match }) => {
        const token = match[1];
        const typed = match[2];
        const idx = formulaSubscripts(token);
        const subType = state.schema.marks.subscript;
        if (!idx || !subType) return null;
        const { tr } = state;
        // The range covers the whole match, typed character included (it is already in the document).
        const tokenFrom = range.to - typed.length - token.length;
        for (const i of idx) tr.addMark(tokenFrom + i, tokenFrom + i + 1, subType.create());
      },
    });

    const charge = new InputRule({
      find: CHARGE_FIND,
      handler: ({ state, range, match }) => {
        const supType = state.schema.marks.superscript;
        if (!supType) return null;
        const { tr } = state;
        const keep = tr.doc.resolve(range.to).marks().filter((m) => m.type !== supType);
        tr.addMark(range.to - match[1].length, range.to, supType.create());
        tr.setStoredMarks(keep);
      },
    });

    const symbols = SYMBOL_RULES.map(
      ([find, replace]) =>
        new InputRule({
          find,
          handler: ({ state, range, match }) => {
            state.tr.insertText(replace(match), range.from, range.to);
          },
        }),
    );

    return [formula, charge, ...symbols];
  },
});
