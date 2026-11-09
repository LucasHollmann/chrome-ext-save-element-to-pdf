/**
 * Testes da captura num Chrome de verdade.
 *
 * `captureElement` depende de `getComputedStyle`, pseudo-elementos, shadow DOM
 * e `canvas.toDataURL` — coisas que nenhum DOM simulado reproduz com
 * fidelidade. Como é o código mais arriscado do projeto, ele é exercitado no
 * próprio navegador de destino.
 *
 * Rodar com `npm run test:browser`. Requer `puppeteer-core` e um Chrome
 * instalado (defina `CHROME_PATH` se não estiver num caminho padrão).
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const FIXTURE = pathToFileURL(resolve(import.meta.dirname, 'fixture.html')).href;

/** Caminhos usuais do Chrome, por plataforma. */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Chrome não encontrado. Defina CHROME_PATH. Tentados:\n${CHROME_CANDIDATES.join('\n')}`,
    );
  }
  return found;
}

/**
 * Empacota `captureElement` como IIFE para poder ser injetado na página.
 *
 * @param {string} outDir
 * @returns {Promise<string>} caminho do bundle
 */
async function bundleCapture(outDir) {
  const entry = join(outDir, 'entry.js');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    entry,
    `import { captureElement } from ${JSON.stringify(
      pathToFileURL(resolve(ROOT, 'src/shared/capture.js')).href,
    )};\nglobalThis.captureElement = captureElement;\n`,
  );

  await build({
    root: ROOT,
    logLevel: 'silent',
    publicDir: false,
    build: {
      target: 'chrome120',
      outDir,
      emptyOutDir: false,
      rollupOptions: {
        input: entry,
        output: { format: 'iife', entryFileNames: 'capture.js', inlineDynamicImports: true },
      },
    },
  });

  return join(outDir, 'capture.js');
}

describe('captureElement no Chrome', () => {
  /** @type {import('puppeteer-core').Browser} */
  let browser;
  /** @type {import('puppeteer-core').Page} */
  let page;
  let workDir;
  /** @type {string[]} */
  const pageErrors = [];
  /** @type {string} */
  let html;

  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'captura-'));
    const bundle = await bundleCapture(workDir);

    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: 'new',
      args: ['--no-sandbox', '--allow-file-access-from-files'],
    });

    page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(FIXTURE, { waitUntil: 'load' });
    await page.addScriptTag({ content: readFileSync(bundle, 'utf8') });

    html = await page.evaluate(() => globalThis.captureElement(document.getElementById('card')));
  });

  after(async () => {
    await browser?.close();
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('não deixa script nem handler inline passar', () => {
    assert.ok(!/<script/i.test(html), 'vazou <script>');
    assert.ok(!/onclick/i.test(html), 'vazou onclick');
    assert.ok(!/javascript:/i.test(html), 'vazou javascript:');
  });

  it('resolve URLs relativas contra a página de origem', () => {
    assert.match(html, /href="file:\/\/\/[^"]*rel\/destino\.html"/);
    assert.match(html, /file:\/\/\/[^" ]*foto2\.png/);
  });

  it('materializa pseudo-elementos e descarta display:none', () => {
    assert.ok(html.includes('\u2713'), 'perdeu o ::before');
    assert.ok(!html.includes('Nao deve aparecer'), 'trouxe um elemento oculto');
  });

  it('rasteriza canvas e congela o estado dos campos', () => {
    assert.match(html, /<img[^>]+src="data:image\/png;base64,/);
    assert.match(html, /value="digitado"/);
    assert.ok(html.includes('texto da area'));
  });

  it('traz o conteúdo do shadow DOM', () => {
    assert.ok(html.includes('conteudo do shadow'));
  });

  it('embute os estilos que a página de destino não teria', () => {
    assert.match(html, /background-color:\s*rgb\(238,\s*238,\s*255\)/);
    // Propriedade herdada precisa viajar na raiz: a página de impressão tem
    // fonte própria, que vazaria para dentro do elemento capturado.
    assert.match(html, /font-family:\s*Georgia/i);
  });

  it('não fixa altura, para o conteúdo poder refluir noutra largura', async () => {
    const fixedHeights = await page.evaluate((captured) => {
      const box = document.createElement('div');
      box.style.cssText = 'width:200px;position:absolute;left:-9999px;';
      box.innerHTML = captured;
      document.body.append(box);
      const nodes = [box.firstElementChild, ...box.querySelectorAll('*')];
      return nodes.filter((node) =>
        /(^|;)\s*(height|block-size|min-height|min-block-size)\s*:/.test(
          node.getAttribute('style') || '',
        ),
      ).length;
    }, html);

    assert.equal(fixedHeights, 0);
  });

  it('não roda o script da página capturada', async () => {
    assert.deepEqual(pageErrors, []);
  });

  it('gera HTML muito menor que inlinar todas as propriedades computadas', async () => {
    const sizes = await page.evaluate(() => {
      const big = document.createElement('section');
      for (let index = 0; index < 150; index += 1) {
        const row = document.createElement('div');
        row.innerHTML = `<h3>Titulo ${index}</h3><p>Paragrafo <strong>${index}</strong> com <em>enfase</em>.</p>`;
        big.append(row);
      }
      document.body.append(big);

      // Reproduz a abordagem anterior: toda propriedade computada vira inline.
      const excluded = new Set([
        'position',
        'top',
        'right',
        'bottom',
        'left',
        'z-index',
        'transform',
        'perspective',
      ]);
      const inlineEverything = (source, clone) => {
        if (source.nodeType !== 1 || clone.nodeType !== 1) return;
        const computed = getComputedStyle(source);
        for (const property of computed) {
          if (!excluded.has(property)) {
            clone.style.setProperty(property, computed.getPropertyValue(property));
          }
        }
        const sources = [...source.children];
        const clones = [...clone.children];
        sources.forEach((child, index) => {
          if (clones[index]) inlineEverything(child, clones[index]);
        });
      };

      const naive = big.cloneNode(true);
      inlineEverything(big, naive);

      return {
        atual: globalThis.captureElement(big).length,
        anterior: naive.outerHTML.length,
      };
    });

    // Na medição original a diferença é de ~40×; 10× já prova a economia sem
    // tornar o teste refém de detalhes do motor de estilos.
    assert.ok(
      sizes.atual * 10 < sizes.anterior,
      `esperava redução de ao menos 10x, obtido ${(sizes.anterior / sizes.atual).toFixed(1)}x`,
    );
  });
});
