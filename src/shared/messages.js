/**
 * Tipos das mensagens trocadas entre painel lateral, service worker e content
 * script.
 *
 * Toda escrita no armazenamento passa pelo service worker: o painel só lê. Com
 * um dono só, uma captura que chega no meio de uma reordenação não sobrescreve
 * a outra.
 */
export const MESSAGE = Object.freeze({
  /** Painel → service worker: comece a escolher elementos na aba. */
  PICK_ELEMENT: 'PICK_ELEMENT',
  /** Painel → service worker: pare de escolher. */
  CANCEL_PICK: 'CANCEL_PICK',
  /** Painel → service worker: adicione em lote tudo o que casar com o seletor. */
  PICK_BY_SELECTOR: 'PICK_BY_SELECTOR',
  /** Painel → service worker: monte as páginas na aba e imprima. */
  PRINT_PAGES: 'PRINT_PAGES',
  /** Painel → service worker: leia as páginas de uma aba. */
  GET_PAGES: 'GET_PAGES',
  /** Painel → service worker: altere as páginas de uma aba. */
  MUTATE_PAGES: 'MUTATE_PAGES',

  /** Service worker → content script: ative o seletor. */
  START_SELECTION: 'START_SELECTION',
  /** Service worker → content script: desative o seletor. */
  STOP_SELECTION: 'STOP_SELECTION',
  /** Service worker → content script: capture tudo o que casar com o seletor. */
  CAPTURE_SELECTOR: 'CAPTURE_SELECTOR',
  /** Service worker → content script: traga os bytes de uma imagem da página. */
  FETCH_IMAGE: 'FETCH_IMAGE',
  /** Service worker → content script: monte as folhas na página. */
  RENDER_SHEETS: 'RENDER_SHEETS',
  /** Service worker → content script: desmonte as folhas. */
  CLEANUP_SHEETS: 'CLEANUP_SHEETS',

  /** Content script → service worker: elemento capturado. */
  PAGE_CAPTURED: 'PAGE_CAPTURED',
  /** Content script → service worker: vários elementos capturados de uma vez. */
  PAGES_CAPTURED: 'PAGES_CAPTURED',
  /** Content script → painel: a escolha foi cancelada na página (Esc). */
  PICK_CANCELLED: 'PICK_CANCELLED',

  /** Service worker → painel: as páginas de uma aba mudaram. */
  PAGES_UPDATED: 'PAGES_UPDATED',
  /** Service worker → painel: andamento da geração do PDF. */
  PDF_PROGRESS: 'PDF_PROGRESS',
});

/** Operações aceitas por `MUTATE_PAGES`. */
export const MUTATION = Object.freeze({
  MOVE: 'move',
  REMOVE: 'remove',
  CLEAR: 'clear',
});

/** Formato de identificador de página (UUID de `crypto.randomUUID`). */
export const ID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}
