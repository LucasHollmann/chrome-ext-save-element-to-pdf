import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Build separado do content script.
 *
 * `chrome.scripting.executeScript({ files })` injeta scripts clássicos, que não
 * aceitam `import`. Um bundle IIFE próprio é o que permite ao content script
 * compartilhar os módulos de `src/shared/` com o resto da extensão em vez de
 * duplicar a lógica de captura e sanitização.
 */
export default defineConfig({
  publicDir: false,
  build: {
    target: 'chrome120',
    // Roda depois do build principal e precisa preservar o que já está em dist.
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/content.js'),
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        inlineDynamicImports: true,
      },
    },
  },
});
