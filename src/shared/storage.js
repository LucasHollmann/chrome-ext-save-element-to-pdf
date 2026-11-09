/**
 * Armazenamento das páginas montadas, em IndexedDB.
 *
 * As páginas vivem na origem da extensão (o painel lateral é uma página de
 * extensão), então sobrevivem a fechar e reabrir o painel. O armazenamento de
 * sessão do Chrome não serve: um elemento com estilos embutidos passa fácil do
 * limite de tamanho dele.
 *
 * Cada aba tem o seu próprio conjunto de páginas, e o conjunto morre junto com
 * a aba.
 */

import { t } from './i18n.js';

const DATABASE_NAME = 'element-pdf-pages';
const DATABASE_VERSION = 2;
const STORE_NAME = 'pages';
const OUTPUT_STORE = 'output';

/** Idade máxima de um conjunto órfão antes da coleta. */
export const MAX_RECORD_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} CapturedPage
 * @property {string} id
 * @property {string} label rótulo curto, derivado do texto do elemento
 * @property {string} html HTML com os estilos computados embutidos
 * @property {string} [imageUrl] quando a página é uma imagem sozinha, a URL
 *   dela: assim o PDF embute o arquivo original em vez de um bitmap
 *   re-codificado pelo mecanismo de impressão
 * @property {number} width largura do elemento na origem, em px
 * @property {number} height altura do elemento na origem, em px
 */

/**
 * @typedef {object} TabPages
 * @property {CapturedPage[]} pages na ordem em que serão impressas
 * @property {number} updatedAt
 */

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
      if (!database.objectStoreNames.contains(OUTPUT_STORE)) {
        database.createObjectStore(OUTPUT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(t('errStorageOpen')));
    request.onblocked = () => reject(new Error(t('errStorageOpen')));
  });
}

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(t('errStorageWrite')));
  });
}

/**
 * @param {IDBTransaction} transaction
 * @returns {Promise<void>}
 */
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(t('errStorageWrite')));
    transaction.onabort = () => reject(transaction.error || new Error(t('errStorageAborted')));
  });
}

/**
 * Abre o banco, executa `operation` e fecha a conexão.
 *
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => Promise<T>} operation
 * @param {string} [storeName]
 * @returns {Promise<T>}
 */
async function withStore(mode, operation, storeName = STORE_NAME) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const result = await operation(transaction.objectStore(storeName));
    await transactionDone(transaction);
    return result;
  } finally {
    database.close();
  }
}

/** @returns {TabPages} */
function emptyRecord() {
  return { pages: [], updatedAt: Date.now() };
}

/**
 * @param {number} tabId
 * @returns {Promise<TabPages>}
 */
export async function readTabPages(tabId) {
  const record = await withStore('readonly', (store) => requestDone(store.get(tabId)));
  if (!record) return emptyRecord();
  return {
    pages: Array.isArray(record.pages) ? record.pages : [],
    updatedAt: record.updatedAt || Date.now(),
  };
}

/**
 * @param {number} tabId
 * @param {Partial<TabPages>} changes
 * @returns {Promise<TabPages>} o registro já atualizado
 */
export async function updateTabPages(tabId, changes) {
  const current = await readTabPages(tabId);
  const next = { ...current, ...changes, updatedAt: Date.now() };
  await withStore('readwrite', (store) => requestDone(store.put(next, tabId)));
  return next;
}

/**
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function clearTabPages(tabId) {
  await withStore('readwrite', (store) => requestDone(store.delete(tabId)));
}

/**
 * Remove conjuntos órfãos: os de abas que já não existem e os velhos demais.
 *
 * @param {Set<number>} openTabIds
 * @param {number} [maxAgeMs]
 * @returns {Promise<number>} quantidade removida
 */
export async function purgeOrphanPages(openTabIds, maxAgeMs = MAX_RECORD_AGE_MS) {
  const oldestAllowed = Date.now() - maxAgeMs;
  return withStore('readwrite', async (store) => {
    const keys = await requestDone(store.getAllKeys());
    const records = await requestDone(store.getAll());
    let removed = 0;

    for (const [index, key] of keys.entries()) {
      const record = records[index];
      const expired = !record?.updatedAt || record.updatedAt < oldestAllowed;
      if (!openTabIds.has(Number(key)) || expired) {
        await requestDone(store.delete(key));
        removed += 1;
      }
    }

    return removed;
  });
}

/**
 * @typedef {object} PdfOutput
 * @property {Blob} blob
 * @property {string} filename
 */

/**
 * Guarda o PDF gerado para o painel buscar.
 *
 * O arquivo não trafega por `chrome.runtime.sendMessage`: com dezenas de
 * páginas ele passa do tamanho máximo de uma mensagem, e a geração falhava
 * inteira no fim. Pelo banco, o service worker grava um `Blob` e o painel — que
 * é da mesma origem — lê sem que nada precise virar string.
 *
 * @param {number} tabId
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<void>}
 */
export async function putPdfOutput(tabId, blob, filename) {
  await withStore(
    'readwrite',
    (store) => requestDone(store.put({ blob, filename, createdAt: Date.now() }, tabId)),
    OUTPUT_STORE,
  );
}

/**
 * @param {number} tabId
 * @returns {Promise<PdfOutput | undefined>}
 */
export function readPdfOutput(tabId) {
  return withStore('readonly', (store) => requestDone(store.get(tabId)), OUTPUT_STORE);
}

/**
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function deletePdfOutput(tabId) {
  await withStore('readwrite', (store) => requestDone(store.delete(tabId)), OUTPUT_STORE);
}
