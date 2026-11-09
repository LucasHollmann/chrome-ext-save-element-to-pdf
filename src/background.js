/**
 * Service worker.
 *
 * Abre o painel lateral no clique do ícone, injeta o content script sob
 * demanda e é o único a escrever no armazenamento das páginas.
 */

import { MESSAGE, MUTATION, isValidId } from './shared/messages.js';
import { PDFDocument } from 'pdf-lib';
import { t } from './shared/i18n.js';
import { buildPrintStyle } from './shared/print-sheets.js';
import { isUnsafeUrl } from './shared/sanitize.js';
import { readImagePreset, resampleTargetFor } from './shared/settings.js';

/**
 * Último CSS de impressão injetado em cada aba.
 *
 * `insertCSS` acumula folhas: sem remover a anterior, imprimir várias vezes na
 * mesma aba empilharia uma folha por impressão. O mapa vive só na memória do
 * service worker; se ele reiniciar, sobra no máximo uma folha inerte.
 *
 * @type {Map<number, string>}
 */
const injectedPrintCss = new Map();
import {
  clearTabPages,
  deletePdfOutput,
  purgeOrphanPages,
  putPdfOutput,
  readTabPages,
  updateTabPages,
} from './shared/storage.js';

// O painel é o ponto de entrada: não há mais popup.
chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab?.id !== 'number') return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    // `open()` exige gesto do usuário; fora disso não há o que fazer aqui.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  /** @type {Promise<object> | null} */
  let work = null;

  switch (message?.type) {
    case MESSAGE.PICK_ELEMENT:
      work = startSelection(message.tabId).then(() => ({}));
      break;
    case MESSAGE.CANCEL_PICK:
      work = stopSelection(message.tabId).then(() => ({}));
      break;
    case MESSAGE.PICK_BY_SELECTOR:
      work = captureBySelector(message.tabId, message.selector);
      break;
    case MESSAGE.PRINT_PAGES:
      // Devolve `{ pdf, filename }`: o painel é quem salva o arquivo.
      work = printPages(message.tabId);
      break;
    case MESSAGE.GET_PAGES:
      work = readTabPages(requireTabId(message.tabId)).then((record) => ({ record }));
      break;
    case MESSAGE.MUTATE_PAGES:
      work = mutatePages(message).then((record) => ({ record }));
      break;
    case MESSAGE.PAGE_CAPTURED:
      work = addCapturedPages([message.page], sender).then((record) => ({ record }));
      break;
    case MESSAGE.PAGES_CAPTURED:
      work = addCapturedPages(message.pages, sender).then((record) => ({ record }));
      break;
    default:
      return false;
  }

  work.then(
    (payload) => sendResponse({ ok: true, ...payload }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});

/**
 * @param {unknown} tabId
 * @returns {number}
 */
function requireTabId(tabId) {
  if (typeof tabId !== 'number') throw new Error(t('errNoTab'));
  return tabId;
}

/**
 * Garante o content script na aba e devolve o id validado.
 *
 * @param {unknown} rawTabId
 * @returns {Promise<number>}
 */
async function ensureContentScript(rawTabId) {
  const tabId = requireTabId(rawTabId);

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error(t('errNoTab'));
  }

  if (!tab.url || !/^https?:/.test(tab.url)) {
    throw new Error(t('errUnsupportedPage'));
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    throw new Error(t('errNoAccess'));
  }

  return tabId;
}

/**
 * @param {number} tabId
 * @param {object} message
 * @returns {Promise<object>}
 */
async function sendToTab(tabId, message) {
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, message);
  } catch {
    throw new Error(t('errNoContentScript'));
  }
  if (!response?.ok) throw new Error(response?.error || t('errSelectFailed'));
  return response;
}

/**
 * @param {unknown} rawTabId
 * @returns {Promise<void>}
 */
async function startSelection(rawTabId) {
  const tabId = await ensureContentScript(rawTabId);
  await sendToTab(tabId, { type: MESSAGE.START_SELECTION });
}

/**
 * Adiciona em lote tudo o que casar com um seletor CSS, uma página por elemento.
 *
 * @param {unknown} rawTabId
 * @param {unknown} selector
 * @returns {Promise<{ count: number }>}
 */
async function captureBySelector(rawTabId, selector) {
  const tabId = await ensureContentScript(rawTabId);
  const response = await sendToTab(tabId, { type: MESSAGE.CAPTURE_SELECTOR, selector });
  return { count: Number(response.count) || 0 };
}

/**
 * @param {unknown} rawTabId
 * @returns {Promise<void>}
 */
async function stopSelection(rawTabId) {
  const tabId = requireTabId(rawTabId);
  try {
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE.STOP_SELECTION });
  } catch {
    // Se o content script já não está lá, não há seletor para desligar.
  }
}

/**
 * @param {unknown} rawTabId
 * @returns {Promise<void>}
 */
async function printPages(rawTabId) {
  const tabId = await ensureContentScript(rawTabId);
  const record = await readTabPages(tabId);
  if (record.pages.length === 0) throw new Error(t('errNoPages'));

  const total = record.pages.length;
  const preset = await readImagePreset();
  const document_ = await PDFDocument.create();
  const target = { tabId };
  let attached = false;
  let done = 0;

  try {
    for (const job of buildJobs(record.pages)) {
      notifyProgress(tabId, done, total, 'render');

      // Imagem limpa: o arquivo original entra direto no PDF, sem passar pelo
      // mecanismo de impressão. É o que evita o bitmap re-codificado sem perdas,
      // que inflava o arquivo em várias vezes — e dispensa o depurador.
      if (job.type === 'image' && (await addImagePage(document_, tabId, job.page, preset))) {
        done += 1;
        continue;
      }

      const pages = job.type === 'image' ? [job.page] : job.pages;
      if (!attached) {
        await attachDebugger(target);
        attached = true;
      }

      await applyPrintCss(tabId, pages);
      await sendToTab(tabId, { type: MESSAGE.RENDER_SHEETS, pages });
      await appendRenderedPdf(document_, await renderPdf(target));
      done += pages.length;
    }
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE.CLEANUP_SHEETS }).catch(() => undefined);
  }

  notifyProgress(tabId, total, total, 'save');

  // O arquivo vai pelo banco, não pela mensagem de resposta: com dezenas de
  // páginas ele passa do tamanho máximo de uma mensagem e a geração falhava no
  // último passo, depois de todo o trabalho já feito.
  const bytes = await document_.save();
  await putPdfOutput(
    tabId,
    new Blob([bytes], { type: 'application/pdf' }),
    await pdfFilename(tabId),
  );
  return { ready: true };
}

/**
 * @typedef {{ type: 'image', page: import('./shared/storage.js').CapturedPage }
 *   | { type: 'render', pages: import('./shared/storage.js').CapturedPage[] }} PdfJob
 */

/**
 * Divide as páginas em trabalhos, na ordem original.
 *
 * Páginas vizinhas de mesmo tamanho vão numa chamada de impressão só: cada
 * documento parcial embute o seu próprio subconjunto de fontes, e juntar dezenas
 * deles multiplica isso no arquivo final. Só dá para agrupar páginas de mesmo
 * tamanho, porque é a regra `@page` sem nome que vale — a nomeada o Chrome
 * ignora ao dimensionar.
 *
 * @param {import('./shared/storage.js').CapturedPage[]} pages
 * @returns {PdfJob[]}
 */
function buildJobs(pages) {
  /** @type {PdfJob[]} */
  const jobs = [];

  for (const page of pages) {
    if (typeof page.imageUrl === 'string' && page.imageUrl) {
      jobs.push({ type: 'image', page });
      continue;
    }

    const last = jobs[jobs.length - 1];
    const sameSize =
      last?.type === 'render' &&
      last.pages[0].width === page.width &&
      last.pages[0].height === page.height;

    if (sameSize) last.pages.push(page);
    else jobs.push({ type: 'render', pages: [page] });
  }

  return jobs;
}

/** Quantos pontos PDF tem um pixel de CSS. */
const PX_TO_PT = 0.75;

/**
 * Acrescenta uma página com a imagem original embutida.
 *
 * @param {import('pdf-lib').PDFDocument} document_
 * @param {number} tabId
 * @param {import('./shared/storage.js').CapturedPage} page
 * @param {import('./shared/settings.js').ImagePresetName} preset
 * @returns {Promise<boolean>} `false` quando não deu, para cair na impressão
 */
async function addImagePage(document_, tabId, page, preset) {
  try {
    const data = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE.FETCH_IMAGE,
      url: page.imageUrl,
      ...resampleTargetFor(preset, page.width),
    });
    if (!data?.ok || !data.base64) return false;

    const bytes = Uint8Array.from(atob(data.base64), (character) => character.charCodeAt(0));
    const image =
      data.type === 'png' ? await document_.embedPng(bytes) : await document_.embedJpg(bytes);

    // Em pontos, como as páginas que vêm da impressão, para não saírem maiores.
    const width = page.width * PX_TO_PT;
    const height = page.height * PX_TO_PT;
    document_.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
    return true;
  } catch {
    // Imagem de outra origem sem CORS, formato que não dá para transcodificar,
    // bytes corrompidos: qualquer um desses cai no caminho normal.
    return false;
  }
}

/**
 * Copia para o documento final as páginas de um PDF parcial.
 *
 * @param {import('pdf-lib').PDFDocument} document_
 * @param {string} base64
 * @returns {Promise<void>}
 */
async function appendRenderedPdf(document_, base64) {
  const source = await PDFDocument.load(base64);
  const copied = await document_.copyPages(source, source.getPageIndices());
  for (const page of copied) document_.addPage(page);
}

/**
 * @param {{ tabId: number }} target
 * @returns {Promise<void>}
 */
async function attachDebugger(target) {
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (error) {
    // Acontece sobretudo com o DevTools aberto na aba: só um cliente por vez.
    throw new Error(
      /attached|another/i.test(error?.message || '') ? t('errDebuggerBusy') : t('errPdfFailed'),
    );
  }
}

/**
 * Injeta o CSS da impressão para um conjunto de folhas, trocando o anterior.
 *
 * Vai por `insertCSS`, e não por um `<style>` criado no content script: um
 * `<style>` fica sujeito ao CSP do site, que pode bloqueá-lo. As regras são
 * guardadas por `:has()`, então o que sobrar depois não afeta o site.
 *
 * @param {number} tabId
 * @param {import('./shared/storage.js').CapturedPage[]} pages
 * @returns {Promise<void>}
 */
async function applyPrintCss(tabId, pages) {
  const css = buildPrintStyle(pages);
  const previous = injectedPrintCss.get(tabId);
  if (previous && previous !== css) {
    await chrome.scripting
      .removeCSS({ target: { tabId }, css: previous, origin: 'USER' })
      .catch(() => undefined);
  }

  try {
    // `origin: 'USER'` coloca as regras na origem de usuário, que vence o
    // `!important` do autor — é o que permite sobrepor o `@media print` do site.
    await chrome.scripting.insertCSS({ target: { tabId }, css, origin: 'USER' });
    injectedPrintCss.set(tabId, css);
  } catch {
    throw new Error(t('errNoAccess'));
  }
}

/**
 * Gera o PDF do que estiver montado na aba.
 *
 * @param {{ tabId: number }} target
 * @returns {Promise<string>} o PDF em base64
 */
async function renderPdf(target) {
  const result = await chrome.debugger.sendCommand(target, 'Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    transferMode: 'ReturnAsBase64',
  });

  if (!result?.data) throw new Error(t('errPdfFailed'));
  return result.data;
}

/**
 * Nome de arquivo derivado do título da aba.
 *
 * @param {number} tabId
 * @returns {Promise<string>}
 */
async function pdfFilename(tabId) {
  let base = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    base = (tab.title || '').trim();
  } catch {
    base = '';
  }

  const limpo = base
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return `${limpo || t('extName')}.pdf`;
}

/**
 * Guarda as páginas capturadas e avisa o painel.
 *
 * Um lote inteiro entra numa escrita só: gravar uma a uma reescreveria o
 * registro completo — com o HTML de todas as páginas — a cada elemento.
 *
 * @param {unknown} pages
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<import('./shared/storage.js').TabPages>}
 */
async function addCapturedPages(pages, sender) {
  const tabId = requireTabId(sender?.tab?.id);
  const entrada = Array.isArray(pages) ? pages : [];
  const validas = entrada
    .filter((page) => page && isValidId(page.id) && typeof page.html === 'string' && page.html)
    .map((page) => ({
      id: page.id,
      label: typeof page.label === 'string' ? page.label.slice(0, 80) : '',
      html: page.html,
      width: Math.max(1, Math.round(Number(page.width) || 1)),
      height: Math.max(1, Math.round(Number(page.height) || 1)),
      ...(typeof page.imageUrl === 'string' && !isUnsafeUrl(page.imageUrl)
        ? { imageUrl: page.imageUrl }
        : {}),
    }));

  if (validas.length === 0) throw new Error(t('errEmptyCapture'));

  const current = await readTabPages(tabId);
  const record = await updateTabPages(tabId, { pages: [...current.pages, ...validas] });

  notifyPanel(tabId, record);
  return record;
}

/**
 * @param {{ tabId?: unknown, action?: unknown, id?: unknown, from?: unknown, to?: unknown }} message
 * @returns {Promise<import('./shared/storage.js').TabPages>}
 */
async function mutatePages(message) {
  const tabId = requireTabId(message.tabId);
  const current = await readTabPages(tabId);

  /** @type {Partial<import('./shared/storage.js').TabPages>} */
  let changes;

  switch (message.action) {
    case MUTATION.MOVE: {
      const pages = [...current.pages];
      const from = Number(message.from);
      const to = Number(message.to);
      if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(t('errBadRequest'));
      if (from < 0 || from >= pages.length || to < 0 || to >= pages.length || from === to) {
        return current;
      }
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      changes = { pages };
      break;
    }
    case MUTATION.REMOVE: {
      if (!isValidId(message.id)) throw new Error(t('errBadRequest'));
      changes = { pages: current.pages.filter((page) => page.id !== message.id) };
      break;
    }
    case MUTATION.CLEAR: {
      await clearTabPages(tabId);
      const cleared = await readTabPages(tabId);
      notifyPanel(tabId, cleared);
      return cleared;
    }
    default:
      throw new Error(t('errBadRequest'));
  }

  const record = await updateTabPages(tabId, changes);
  notifyPanel(tabId, record);
  return record;
}

/**
 * Informa ao painel quantas páginas já foram processadas.
 *
 * Gerar o PDF é um laço de uma chamada de impressão por elemento, e numa
 * captura em lote isso leva tempo: sem andamento, o painel ficaria parado num
 * "gerando" indefinido.
 *
 * @param {number} tabId
 * @param {number} done
 * @param {number} total
 * @param {'render' | 'merge'} stage
 */
function notifyProgress(tabId, done, total, stage) {
  chrome.runtime
    .sendMessage({ type: MESSAGE.PDF_PROGRESS, tabId, done, total, stage })
    .catch(() => undefined);
}

/**
 * Avisa o painel lateral. Se ele estiver fechado não há ninguém ouvindo, e o
 * erro de "receiving end does not exist" é esperado.
 *
 * @param {number} tabId
 * @param {import('./shared/storage.js').TabPages} record
 */
function notifyPanel(tabId, record) {
  chrome.runtime.sendMessage({ type: MESSAGE.PAGES_UPDATED, tabId, record }).catch(() => undefined);
}

/** Remove conjuntos de abas que já não existem. */
async function purgeOrphans() {
  try {
    const tabs = await chrome.tabs.query({});
    const openTabIds = new Set(tabs.map((tab) => tab.id).filter((id) => typeof id === 'number'));
    await purgeOrphanPages(openTabIds);
  } catch {
    // A coleta é oportunista: falhar aqui não deve quebrar nada.
  }
}

// As páginas pertencem à aba e morrem com ela.
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedPrintCss.delete(tabId);
  void clearTabPages(tabId).catch(() => undefined);
  void deletePdfOutput(tabId).catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => void purgeOrphans());
chrome.runtime.onInstalled.addListener(() => void purgeOrphans());
