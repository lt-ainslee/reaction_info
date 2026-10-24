// "Observation / result" block for procedures: what was seen (colour change,
// precipitate, TLC) kept apart from what was done.
import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    observation: {
      toggleObservation: () => ReturnType;
    };
  }
}

export const Observation = Node.create<{ label: string }>({
  name: 'observation',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { label: 'Observation' };
  },

  parseHTML() {
    return [{ tag: 'div[data-observation]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-observation': '', 'data-label': this.options.label, class: 'proc-obs' }), 0];
  },

  addCommands() {
    return {
      toggleObservation:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Alt-o': () => this.editor.commands.toggleObservation() };
  },
});
