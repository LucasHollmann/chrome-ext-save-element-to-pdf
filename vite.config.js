import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createManifest } from './src/manifest.config.js';

const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'));

/**
 * Emite `manifest.json` a partir de `src/manifest.config.js`, com a versão do
 * `package.json`.
 *
 * @returns {import('vite').Plugin}
 */
function manifestPlugin() {
  return {
    name: 'emit-extension-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(createManifest(packageJson.version), null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [manifestPlugin()],
  build: {
    // O service worker é um módulo ES, então não há transpilação para IIFE aqui.
    target: 'chrome120',
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        background: resolve(import.meta.dirname, 'src/background.js'),
      },
      output: {
        // O manifest aponta para `background.js` na raiz; o resto vai com hash.
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
