import './print.css';

const printContent = document.getElementById('print-content');
const printButton = document.getElementById('print-button');
const editModeButton = document.getElementById('edit-mode');
const hoverOutline = document.getElementById('hover-outline');
const orientationPicker = document.getElementById('orientation-picker');
const paginationPicker = document.getElementById('pagination-picker');
const contextMenu = document.getElementById('context-menu');
const addManualPageAction = document.getElementById('add-manual-page');
const manualSourceToggle = document.getElementById('manual-source-toggle');
const manualPagesPanel = document.getElementById('manual-pages-panel');
const manualPagesList = document.getElementById('manual-pages-list');
const manualPagesEmpty = document.getElementById('manual-pages-empty');
const manualPageCount = document.getElementById('manual-page-count');
const manualPrintPages = document.getElementById('manual-print-pages');
const stylePanel = document.getElementById('style-panel');
const styleInputs = [...stylePanel.querySelectorAll('[data-style]')];
const token = new URLSearchParams(window.location.search).get('token');
let contextTarget = null;
let orientation = 'portrait';
let editMode = false;
let pagination = 'automatic';
let sourceElement = null;
let manualPages = [];
let selectedManualPageId = null;
let showingSource = true;

function setPrintOrientation(value) {
  const safeOrientation = value === 'landscape' ? 'landscape' : 'portrait';
  orientation = safeOrientation;
  document.body.dataset.orientation = safeOrientation;
  for (const button of orientationPicker.querySelectorAll('[data-orientation]')) {
    button.setAttribute('aria-pressed', String(button.dataset.orientation === safeOrientation));
  }
  updatePrintPageRules();
}

function setPaginationMode(value) {
  const nextMode = value === 'manual' ? 'manual' : 'automatic';
  if (pagination === nextMode) return;
  pagination = nextMode;
  document.body.dataset.pagination = pagination;
  for (const button of paginationPicker.querySelectorAll('[data-pagination]')) {
    button.setAttribute('aria-pressed', String(button.dataset.pagination === pagination));
  }
  manualPagesPanel.hidden = pagination !== 'manual';
  manualSourceToggle.hidden = pagination !== 'manual';
  showingSource = true;
  showSourceElement();
  closeContextMenu();
  renderManualPages();
  updatePrintButton();
  updatePrintPageRules();
}

function showSourceElement() {
  showingSource = true;
  contextTarget = null;
  closeContextMenu();
  closeStylePanel();
  printContent.hidden = false;
  printContent.classList.remove('manual-page-view');
  if (sourceElement) printContent.replaceChildren(sourceElement);
  manualSourceToggle.textContent = 'Ver página selecionada';
  manualSourceToggle.disabled = !selectedManualPageId;
  renderManualPages();
}

function showManualPage(id) {
  const page = manualPages.find((item) => item.id === id);
  if (!page) return;
  showingSource = false;
  selectedManualPageId = id;
  contextTarget = null;
  closeContextMenu();
  closeStylePanel();
  printContent.hidden = false;
  printContent.replaceChildren(page.element);
  printContent.classList.add('manual-page-view');
  page.element.style.setProperty('width', `${page.width}px`, 'important');
  page.element.style.setProperty('height', `${page.height}px`, 'important');
  manualSourceToggle.textContent = 'Selecionar elementos';
  manualSourceToggle.disabled = false;
  renderManualPages();
}

function measureManualPage(page) {
  const rect = page.element.getBoundingClientRect();
  if (rect.width > 0) page.width = Math.ceil(rect.width);
  if (rect.height > 0 || page.element.scrollHeight > 0) {
    page.height = Math.ceil(Math.max(rect.height, page.element.scrollHeight));
  }
}

function renderManualPages() {
  manualPagesList.replaceChildren();
  manualPagesEmpty.hidden = manualPages.length > 0;
  manualPageCount.textContent = `${manualPages.length} ${manualPages.length === 1 ? 'página' : 'páginas'}`;

  manualPages.forEach((page, index) => {
    const item = document.createElement('li');
    item.className = 'manual-page-item';
    item.dataset.pageId = page.id;
    item.draggable = true;
    item.setAttribute('aria-current', String(page.id === selectedManualPageId && !showingSource));

    const select = document.createElement('button');
    select.className = 'manual-page-select';
    select.type = 'button';
    select.setAttribute('aria-label', `Página ${index + 1}: ${page.label}`);
    const preview = document.createElement('span');
    preview.className = 'manual-page-thumbnail';
    const clone = page.element.cloneNode(true);
    const scale = Math.min(140 / page.width, 78 / page.height);
    Object.assign(clone.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${page.width}px`,
      height: `${page.height}px`,
      maxWidth: 'none',
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
    });
    clone.setAttribute('aria-hidden', 'true');
    preview.append(clone);
    select.append(preview);

    const caption = document.createElement('span');
    caption.className = 'manual-page-caption';
    caption.textContent = `${index + 1}. ${page.label}`;

    const controls = document.createElement('span');
    controls.className = 'manual-page-order';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.setAttribute('aria-label', `Mover página ${index + 1} para cima`);
    up.disabled = index === 0;
    up.addEventListener('click', () => moveManualPage(index, index - 1));
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.setAttribute('aria-label', `Mover página ${index + 1} para baixo`);
    down.disabled = index === manualPages.length - 1;
    down.addEventListener('click', () => moveManualPage(index, index + 1));
    controls.append(up, down);

    select.addEventListener('click', () => showManualPage(page.id));
    item.append(select, caption, controls);
    item.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', page.id);
      event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const sourceId = event.dataTransfer.getData('text/plain');
      const sourceIndex = manualPages.findIndex((entry) => entry.id === sourceId);
      if (sourceIndex >= 0) moveManualPage(sourceIndex, index);
    });
    manualPagesList.append(item);
  });
}

function moveManualPage(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= manualPages.length || fromIndex === toIndex) return;
  const [page] = manualPages.splice(fromIndex, 1);
  manualPages.splice(toIndex, 0, page);
  renderManualPages();
  updatePrintPageRules();
}

function addManualPage(element) {
  const pageElement = element.cloneNode(true);
  const rect = element.getBoundingClientRect();
  const page = {
    id: crypto.randomUUID(),
    label: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) || element.tagName.toLowerCase(),
    element: pageElement,
    width: Math.max(1, Math.ceil(rect.width)),
    height: Math.max(1, Math.ceil(Math.max(rect.height, element.scrollHeight))),
  };
  manualPages.push(page);
  selectedManualPageId = page.id;
  renderManualPages();
  updatePrintPageRules();
  updatePrintButton();
  closeContextMenu();
  showManualPage(page.id);
}

function updatePrintButton() {
  printButton.disabled = pagination === 'manual'
    ? manualPages.length === 0
    : !sourceElement;
}

function updatePrintPageRules() {
  let pageStyle = document.getElementById('page-orientation-style');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'page-orientation-style';
    document.head.append(pageStyle);
  }
  const rules = [`@page { size: ${orientation}; margin: 12mm; }`];
  if (pagination === 'manual') {
    manualPages.forEach((page, index) => {
      measureManualPage(page);
      rules.push(`@page manual-page-${index + 1} { size: ${page.width}px ${page.height}px; margin: 0; }`);
    });
  }
  pageStyle.textContent = rules.join('\n');
  renderPrintPages();
}

function renderPrintPages() {
  manualPrintPages.replaceChildren();
  if (pagination !== 'manual') return;

  manualPages.forEach((page, index) => {
    const sheet = document.createElement('section');
    sheet.className = 'manual-print-page';
    sheet.style.setProperty('page', `manual-page-${index + 1}`);
    sheet.style.width = `${page.width}px`;
    sheet.style.height = `${page.height}px`;
    const content = page.element.cloneNode(true);
    content.style.setProperty('position', 'static', 'important');
    content.style.setProperty('inset', 'auto', 'important');
    content.style.setProperty('width', `${page.width}px`, 'important');
    content.style.setProperty('height', `${page.height}px`, 'important');
    content.style.setProperty('max-width', 'none', 'important');
    content.style.setProperty('max-height', 'none', 'important');
    content.style.setProperty('margin', '0', 'important');
    content.style.setProperty('transform', 'none', 'important');
    sheet.append(content);
    manualPrintPages.append(sheet);
  });
}

function onStyleInput(event) {
  applyStyleChange(event);
  if (pagination === 'manual' && selectedManualPageId) {
    const page = manualPages.find((item) => item.id === selectedManualPageId);
    if (page) {
      measureManualPage(page);
      page.element.style.setProperty('width', `${page.width}px`, 'important');
      page.element.style.setProperty('height', `${page.height}px`, 'important');
      updatePrintPageRules();
      renderManualPages();
    }
  }
}

async function waitForContent() {
  await document.fonts.ready;
  const images = [...printContent.querySelectorAll('img'), ...manualPrintPages.querySelectorAll('img')];
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }));
}

async function printDocument() {
  if (pagination === 'manual' && manualPages.length === 0) return;
  await waitForContent();
  if (pagination === 'manual') updatePrintPageRules();
  window.print();
}

function cleanElement(element) {
  const blockedTags = new Set([
    'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'STYLE', 'META', 'BASE',
  ]);
  const elements = [element, ...element.querySelectorAll('*')];

  for (const current of elements) {
    if (blockedTags.has(current.tagName)) {
      current.remove();
      continue;
    }

    for (const attribute of [...current.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || name === 'srcdoc') {
        current.removeAttribute(attribute.name);
      } else if (
        ['href', 'src', 'xlink:href', 'formaction'].includes(name) &&
        /^\s*javascript:/i.test(value)
      ) {
        current.removeAttribute(attribute.name);
      }
    }
  }

  return element;
}

function colorToHex(color) {
  const channels = color.match(/[\d.]+/g);
  if (!channels || channels.length < 3) return '#ffffff';
  return `#${channels.slice(0, 3).map((channel) =>
    Math.round(Number(channel)).toString(16).padStart(2, '0'),
  ).join('')}`;
}

function closeContextMenu() {
  contextMenu.hidden = true;
}

function closeStylePanel() {
  stylePanel.hidden = true;
}

function setEditMode(enabled) {
  editMode = enabled;
  document.body.dataset.editMode = String(enabled);
  editModeButton.setAttribute('aria-pressed', String(enabled));
  hoverOutline.hidden = true;

  if (!enabled) {
    contextTarget = null;
    closeContextMenu();
    closeStylePanel();
  }
}

function showHoverOutline(event) {
  if (!editMode) return;
  const target = event.target instanceof Element ? event.target.closest('#print-content *') : null;
  if (!target || !printContent.contains(target)) {
    hoverOutline.hidden = true;
    return;
  }

  const rect = target.getBoundingClientRect();
  Object.assign(hoverOutline.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  hoverOutline.hidden = false;
}

function showContextMenu(event) {
  if (!editMode) return;
  const target = event.target instanceof Element ? event.target.closest('#print-content *') : null;
  if (!target || !printContent.contains(target)) return;

  event.preventDefault();
  contextTarget = target;
  closeStylePanel();
  addManualPageAction.hidden = pagination !== 'manual' || !showingSource;
  contextMenu.hidden = false;

  const menuRect = contextMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - menuRect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - menuRect.height - 8);
  contextMenu.style.left = `${Math.max(8, left)}px`;
  contextMenu.style.top = `${Math.max(8, top)}px`;
}

function openStylePanel() {
  if (!editMode || !contextTarget) return;
  closeContextMenu();
  stylePanel.hidden = false;

  const computed = getComputedStyle(contextTarget);
  for (const input of styleInputs) {
    const property = input.dataset.style;
    if (input.type === 'color') {
      input.value = colorToHex(computed[property]);
    } else {
      input.value = Number.parseFloat(computed[property]) || 0;
    }
  }
}

function applyStyleChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !contextTarget) return;

  const property = input.dataset.style;
  if (!property) return;
  const value = input.type === 'color' ? input.value : `${input.value}px`;
  contextTarget.style.setProperty(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value, 'important');
}

function removeContextTarget() {
  if (!editMode || !contextTarget) return;
  const selectedPage = manualPages.find((page) => page.id === selectedManualPageId);
  if (!showingSource && selectedPage?.element === contextTarget) {
    manualPages = manualPages.filter((page) => page.id !== selectedPage.id);
    selectedManualPageId = manualPages[0]?.id || null;
    renderManualPages();
    updatePrintPageRules();
    updatePrintButton();
    if (selectedManualPageId) showManualPage(selectedManualPageId);
    else showSourceElement();
    return;
  }
  contextTarget.remove();
  contextTarget = null;
  closeContextMenu();
  closeStylePanel();
  if (pagination === 'manual' && selectedPage && !showingSource) {
    measureManualPage(selectedPage);
    updatePrintPageRules();
    renderManualPages();
  }
}

contextMenu.addEventListener('click', (event) => {
  const action = event.target.closest('button');
  if (action?.id === 'add-manual-page') addManualPage(contextTarget);
  if (action?.id === 'edit-element') openStylePanel();
  if (action?.id === 'remove-element') removeContextTarget();
});
paginationPicker.addEventListener('click', (event) => {
  const button = event.target.closest('[data-pagination]');
  if (button) setPaginationMode(button.dataset.pagination);
});
manualSourceToggle.addEventListener('click', () => {
  if (showingSource && selectedManualPageId) showManualPage(selectedManualPageId);
  else showSourceElement();
});
printContent.addEventListener('contextmenu', showContextMenu);
printContent.addEventListener('pointermove', showHoverOutline);
printContent.addEventListener('pointerleave', () => {
  hoverOutline.hidden = true;
});
styleInputs.forEach((input) => input.addEventListener('input', onStyleInput));
editModeButton.addEventListener('click', () => setEditMode(!editMode));
document.getElementById('close-style-panel').addEventListener('click', closeStylePanel);
document.addEventListener('pointerdown', (event) => {
  if (!contextMenu.hidden && !contextMenu.contains(event.target)) closeContextMenu();
  if (!stylePanel.hidden && !stylePanel.contains(event.target)) closeStylePanel();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeContextMenu();
    closeStylePanel();
  }
});
orientationPicker.addEventListener('click', (event) => {
  const button = event.target.closest('[data-orientation]');
  if (button) setPrintOrientation(button.dataset.orientation);
});

async function loadSelection() {
  if (!token) {
    throw new Error('Não foi possível localizar o elemento selecionado.');
  }

  const response = await chrome.runtime.sendMessage({ type: 'GET_PRINT_DATA', token });
  if (!response?.ok) {
    throw new Error(response?.error || 'Não foi possível carregar o elemento.');
  }
  setPrintOrientation(response.data.orientation);

  const parsed = new DOMParser().parseFromString(response.data.html, 'text/html');
  const element = parsed.body.firstElementChild;
  if (!element) {
    throw new Error('O elemento selecionado está vazio.');
  }
  if (['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED'].includes(element.tagName)) {
    throw new Error('Esse tipo de elemento não pode ser preparado para impressão.');
  }

  const base = document.createElement('base');
  base.href = response.data.sourceUrl;
  document.head.prepend(base);
  printContent.replaceChildren(cleanElement(element));
  sourceElement = element;
  document.title = `${response.data.title} - PDF`;
  updatePrintButton();
  printButton.addEventListener('click', printDocument);
}

loadSelection().catch((error) => {
  printContent.textContent = error.message;
  printContent.classList.add('load-error');
});
