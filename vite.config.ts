import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// ketcher-core's ESM build still does `require('raphael')` (guarded by
// `typeof window`), which breaks in the browser. Rewrite it to an import.
function ketcherRaphaelFix(): Plugin {
  return {
    name: 'ketcher-raphael-fix',
    transform(code, id) {
      if (!id.includes('ketcher-core') || !code.includes("require('raphael')")) return null;
      return {
        code: "import __raphael from 'raphael';\n" + code.replace("require('raphael')", '__raphael'),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), ketcherRaphaelFix()],
  // Some Ketcher dependencies expect Node's `global`.
  define: { global: 'globalThis' },
  build: {
    // Ketcher is large but lazily loaded with the structure editor.
    chunkSizeWarningLimit: 9000,
  },
});
