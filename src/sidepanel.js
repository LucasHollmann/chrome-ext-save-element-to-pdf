/**
 * Painel lateral: o único lugar onde o usuário monta o PDF.
 *
 * Ele só lê o armazenamento; toda alteração é pedida ao service worker, que é o
 * dono das escritas.
 */

import './sidepanel.css';
import { MESSAGE, MUTATION } from './shared/messages.js';
import { localizeDocument, t } from './shared/i18n.js';
import { deletePdfOutput, readPdfOutput } from './shared/storage.js';
import { readImagePreset, writeImagePreset } from './shared/settings.js';

const THUMBNAIL_WIDTH = 132;
const THUMBNAIL_HEIGHT = 86;

const dom = {
  pickButton: /** @type {HTMLButtonElement} */ (document.getElementById('pick-button')),
  selectorInput: /** @type {HTMLInputElement} */ (document.getElementById('selector-input')),
  selectorButton: /** @type {HTMLButtonElement} */ (document.getElementById('selector-button')),
  printButton: /** @type {HTMLButtonElement} */ (document.getElementById('print-button')),
  clearButton: /** @type {HTMLButtonElement} */ (document.getElementById('clear-button')),
  pagesList: /** @type {HTMLOListElement} */ (document.getElementById('pages-list')),
  pagesEmpty: /** @type {HTMLElement} */ (document.getElementById('pages-empty')),
  pageCount: /** @type {HTMLElement} */ (document.getElementById('page-count')),
  status: /** @type {HTMLElement} */ (document.getElementById('status')),
  qualitySelect: /** @type {HTMLSelectElement} */ (document.getElementById('quality-select')),
  progress: /** @type {HTMLElement} */ (document.getElementById('progress')),
  progressFill: /** @type {HTMLElement} */ (document.getElementById('progress-fill')),
};

localizeDocument();

/** @type {number | null} */
let tabId = null;
/** Título da aba acompanhada, usado para sugerir o nome do arquivo. */
let tabTitle = '';
/** @type {import('./shared/storage.js').TabPages} */
let record = { pages: [], updatedAt: 0 };
let picking = false;

/**
 * Miniaturas já montadas, por id de página. Remontá-las a cada render custaria
 * caro: o HTML capturado carrega os estilos de toda a subárvore.
 *
 * @type {Map<string, HTMLElement>}
 */
const thumbnailCache = new Map();

/**
 * @param {string} message
 * @param {boolean} [isError]
 */
function showStatus(message, isError = false) {
  dom.status.textContent = message;
  dom.status.hidden = !message;
  dom.status.classList.toggle('status-error', isError);
}

/**
 * @param {object} message
 * @returns {Promise<object>}
 */
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || t('errGeneric'));
  return response;
}

/**
 * Descobre a aba que o painel está acompanhando e carrega as páginas dela.
 *
 * @returns {Promise<void>}
 */
async function syncActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number') return;
  tabTitle = (tab.title || '').trim();

  if (tab.id !== tabId) {
    // Trocou de aba: o seletor da anterior não vale mais.
    picking = false;
    tabId = tab.id;
  }

  try {
    const response = await send({ type: MESSAGE.GET_PAGES, tabId });
    record = response.record;
  } catch {
    record = { pages: [], updatedAt: 0 };
  }

  render();
}

/** Monta (ou reaproveita) a miniatura de uma página. */
function thumbnailFor(page) {
  const cached = thumbnailCache.get(page.id);
  if (cached) return cached;

  const frame = document.createElement('span');
  frame.className = 'page-thumbnail';

  const inner = document.createElement('span');
  const scale = Math.min(THUMBNAIL_WIDTH / page.width, THUMBNAIL_HEIGHT / page.height, 1);
  Object.assign(inner.style, {
    display: 'block',
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${page.width}px`,
    height: `${page.height}px`,
    overflow: 'hidden',
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    background: 'white',
  });

  // O HTML capturado já passou pela sanitização antes de ser guardado; aqui ele
  // só precisa ser remontado sem executar nada.
  const parsed = new DOMParser().parseFromString(page.html, 'text/html');
  const element = parsed.body.firstElementChild;
  if (element) {
    const imported = /** @type {HTMLElement} */ (document.importNode(element, true));
    imported.style.setProperty('position', 'static', 'important');
    imported.style.setProperty('margin', '0', 'important');
    imported.style.setProperty('max-width', 'none', 'important');
    inner.append(imported);
  }

  frame.append(inner);
  frame.setAttribute('aria-hidden', 'true');
  thumbnailCache.set(page.id, frame);
  return frame;
}

/** Remove do cache as miniaturas de páginas que já não existem. */
function pruneThumbnailCache() {
  const alive = new Set(record.pages.map((page) => page.id));
  for (const id of thumbnailCache.keys()) {
    if (!alive.has(id)) thumbnailCache.delete(id);
  }
}

/**
 * @param {string} action
 * @param {object} [extra]
 */
async function mutate(action, extra = {}) {
  try {
    const response = await send({ type: MESSAGE.MUTATE_PAGES, tabId, action, ...extra });
    record = response.record;
    render();
  } catch (error) {
    showStatus(error.message, true);
  }
}

function render() {
  pruneThumbnailCache();

  dom.pageCount.textContent = String(record.pages.length);
  dom.pagesEmpty.hidden = record.pages.length > 0;
  dom.clearButton.hidden = record.pages.length === 0;
  dom.printButton.disabled = record.pages.length === 0;

  dom.selectorButton.disabled = !dom.selectorInput.value.trim();
  dom.pickButton.textContent = picking ? t('stopPicking') : t('addElement');
  dom.pickButton.classList.toggle('picking', picking);

  dom.pagesList.replaceChildren();
  record.pages.forEach((page, index) => {
    const position = index + 1;

    const item = document.createElement('li');
    item.className = 'page-item';
    item.dataset.pageId = page.id;
    item.draggable = true;

    const number = document.createElement('span');
    number.className = 'page-number';
    number.textContent = String(position);

    item.append(number, thumbnailFor(page));

    const info = document.createElement('div');
    info.className = 'page-info';

    const label = document.createElement('span');
    label.className = 'page-label';
    label.textContent = page.label || t('pageFallbackLabel');
    label.title = page.label || '';

    const size = document.createElement('span');
    size.className = 'page-size';
    size.textContent = `${page.width} × ${page.height}`;

    info.append(label, size);
    item.append(info);

    const controls = document.createElement('div');
    controls.className = 'page-controls';

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'icon-button';
    up.textContent = '↑';
    up.setAttribute('aria-label', t('moveUp', [position]));
    up.disabled = index === 0;
    up.addEventListener('click', () => mutate(MUTATION.MOVE, { from: index, to: index - 1 }));

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'icon-button';
    down.textContent = '↓';
    down.setAttribute('aria-label', t('moveDown', [position]));
    down.disabled = index === record.pages.length - 1;
    down.addEventListener('click', () => mutate(MUTATION.MOVE, { from: index, to: index + 1 }));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button danger';
    remove.textContent = '×';
    remove.setAttribute('aria-label', t('removePage', [position]));
    remove.addEventListener('click', () => mutate(MUTATION.REMOVE, { id: page.id }));

    controls.append(up, down, remove);
    item.append(controls);

    item.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      item.classList.remove('drop-target');
      const from = Number(event.dataTransfer?.getData('text/plain'));
      if (Number.isInteger(from)) mutate(MUTATION.MOVE, { from, to: index });
    });

    dom.pagesList.append(item);
  });
}

async function togglePicking() {
  if (typeof tabId !== 'number') return;
  dom.pickButton.disabled = true;

  try {
    if (picking) {
      await send({ type: MESSAGE.CANCEL_PICK, tabId });
      picking = false;
      showStatus('');
    } else {
      await send({ type: MESSAGE.PICK_ELEMENT, tabId });
      picking = true;
      showStatus(t('pickingHint'));
    }
  } catch (error) {
    picking = false;
    showStatus(error.message, true);
  } finally {
    dom.pickButton.disabled = false;
    render();
  }
}

/**
 * Nome de arquivo sugerido, a partir do título da aba.
 *
 * @returns {string}
 */
function suggestedFilename() {
  const limpo = tabTitle
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${limpo || 'documento'}.pdf`;
}

/**
 * Adiciona em lote tudo o que casar com o seletor, uma página por elemento.
 */
async function addBySelector() {
  const selector = dom.selectorInput.value.trim();
  if (typeof tabId !== 'number' || !selector) return;

  dom.selectorButton.disabled = true;
  showStatus(t('batchWorking'));

  try {
    const response = await send({ type: MESSAGE.PICK_BY_SELECTOR, tabId, selector });
    const count = Number(response.count) || 0;
    showStatus(count === 1 ? t('batchAddedOne') : t('batchAdded', [count]));
    dom.selectorInput.value = '';
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    dom.selectorButton.disabled = !dom.selectorInput.value.trim();
    render();
  }
}

/**
 * Atualiza a barra de andamento.
 *
 * @param {number} done
 * @param {number} total
 * @param {'render' | 'merge'} stage
 */
function showProgress(done, total, stage) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  dom.progress.hidden = false;
  dom.progress.dataset.stage = stage;
  dom.progress.setAttribute('aria-valuenow', String(percent));
  dom.progressFill.style.width = `${percent}%`;
  const atual = Math.min(done + 1, total);
  showStatus(stage === 'save' ? t('finalizingPdf') : t('generatingPage', [atual, total]));
}

function hideProgress() {
  dom.progress.hidden = true;
  delete dom.progress.dataset.stage;
  dom.progressFill.style.width = '0%';
  dom.progress.setAttribute('aria-valuenow', '0');
}

/** Gera o PDF das páginas da aba e salva o arquivo. */
async function savePdf() {
  if (typeof tabId !== 'number') return;

  dom.printButton.disabled = true;
  const label = dom.printButton.textContent;
  dom.printButton.textContent = t('preparing');
  showProgress(0, record.pages.length, 'render');

  let objectUrl = null;
  try {
    await send({ type: MESSAGE.PRINT_PAGES, tabId });

    // O arquivo vem pelo banco, e não na resposta: um PDF de dezenas de páginas
    // passa do tamanho máximo de uma mensagem.
    const output = await readPdfOutput(tabId);
    if (!output?.blob) throw new Error(t('errPdfFailed'));

    objectUrl = URL.createObjectURL(output.blob);
    await chrome.downloads.download({
      url: objectUrl,
      filename: output.filename || suggestedFilename(),
      saveAs: true,
    });

    await deletePdfOutput(tabId).catch(() => undefined);
    picking = false;
    showStatus(t('saved'));
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    // Revogar na hora cancelaria o download que acabou de começar.
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    hideProgress();
    dom.printButton.textContent = label;
    render();
  }
}

dom.pickButton.addEventListener('click', () => void togglePicking());
dom.printButton.addEventListener('click', () => void savePdf());
dom.selectorButton.addEventListener('click', () => void addBySelector());
dom.qualitySelect.addEventListener('change', () => {
  void writeImagePreset(dom.qualitySelect.value);
});
dom.selectorInput.addEventListener('input', () => {
  dom.selectorButton.disabled = !dom.selectorInput.value.trim();
});
dom.selectorInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && dom.selectorInput.value.trim()) {
    event.preventDefault();
    void addBySelector();
  }
});
dom.clearButton.addEventListener('click', () => void mutate(MUTATION.CLEAR));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MESSAGE.PAGES_UPDATED && message.tabId === tabId) {
    record = message.record;
    render();
  }

  if (message?.type === MESSAGE.PDF_PROGRESS && message.tabId === tabId) {
    showProgress(message.done, message.total, message.stage);
  }

  if (message?.type === MESSAGE.PICK_CANCELLED) {
    picking = false;
    showStatus('');
    render();
  }

  return false;
});

// O painel é um documento só por janela: ele acompanha a aba que estiver ativa.
chrome.tabs.onActivated.addListener(() => void syncActiveTab());
chrome.tabs.onUpdated.addListener((updatedTabId, changeInfo) => {
  if (updatedTabId === tabId && changeInfo.status === 'complete')
    void readImagePreset().then((preset) => {
      dom.qualitySelect.value = preset;
    });

  void syncActiveTab();
});

void readImagePreset().then((preset) => {
  dom.qualitySelect.value = preset;
});

void syncActiveTab();
