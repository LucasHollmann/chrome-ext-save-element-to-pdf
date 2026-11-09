(() => {
  if (globalThis.__elementPdfPickerLoaded) return;
  globalThis.__elementPdfPickerLoaded = true;

  let active = false;
  let hoveredElement = null;
  let previousOutline = '';
  let previousOutlineOffset = '';
  const highlight = document.createElement('div');
  const instruction = document.createElement('div');

  Object.assign(highlight.style, {
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    border: '2px solid #19a66a',
    background: 'rgba(25, 166, 106, 0.12)',
    boxSizing: 'border-box',
    display: 'none',
  });
  highlight.setAttribute('aria-hidden', 'true');

  Object.assign(instruction.style, {
    position: 'fixed',
    zIndex: '2147483647',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 16px',
    borderRadius: '8px',
    background: '#17211d',
    color: '#fff',
    boxShadow: '0 2px 12px rgba(0,0,0,.25)',
    font: '14px/1.4 system-ui, sans-serif',
    pointerEvents: 'none',
  });
  instruction.textContent = 'Clique no elemento que deseja salvar · Esc para cancelar';

  function restoreOutline() {
    if (!hoveredElement) return;
    hoveredElement.style.outline = previousOutline;
    hoveredElement.style.outlineOffset = previousOutlineOffset;
    hoveredElement = null;
  }

  function stopPicker() {
    active = false;
    restoreOutline();
    highlight.remove();
    instruction.remove();
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function onMouseMove(event) {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === highlight || target === instruction || target === hoveredElement) return;

    restoreOutline();
    hoveredElement = target;
    previousOutline = target.style.outline;
    previousOutlineOffset = target.style.outlineOffset;

    const rect = target.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  function inlineComputedStyles(source, clone) {
    if (source.nodeType !== Node.ELEMENT_NODE || clone.nodeType !== Node.ELEMENT_NODE) return;

    const computed = getComputedStyle(source);
    const excluded = new Set([
      'position', 'top', 'right', 'bottom', 'left', 'z-index', 'transform', 'perspective',
    ]);
    for (const property of computed) {
      if (!excluded.has(property)) {
        clone.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
      }
    }

    const sourceChildren = [...source.children];
    const cloneChildren = [...clone.children];
    sourceChildren.forEach((child, index) => {
      if (cloneChildren[index]) inlineComputedStyles(child, cloneChildren[index]);
    });
  }

  function serializeSelection(element) {
    const clone = element.cloneNode(true);
    inlineComputedStyles(element, clone);
    clone.querySelectorAll('script, iframe, object, embed, link, style').forEach((node) => node.remove());
    clone.querySelectorAll('*').forEach((node) => {
      for (const attribute of [...node.attributes]) {
        if (attribute.name.toLowerCase().startsWith('on') || attribute.name.toLowerCase() === 'srcdoc') {
          node.removeAttribute(attribute.name);
        }
      }
    });
    clone.style.setProperty('position', 'static', 'important');
    clone.style.setProperty('inset', 'auto', 'important');
    clone.style.setProperty('max-width', '100%', 'important');
    clone.style.setProperty('max-height', 'none', 'important');
    clone.style.setProperty('transform', 'none', 'important');
    return clone.outerHTML;
  }

  async function saveSelectedElement(selected) {
    const html = serializeSelection(selected);
    const title = document.title || 'Elemento selecionado';
    const sourceUrl = window.location.href;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'PRINT_SELECTION',
        html,
        title,
        sourceUrl,
      });
      if (!response?.ok) throw new Error(response?.error || 'Não foi possível preparar o PDF.');
      stopPicker();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function onClick(event) {
    if (!active || event.target === highlight || event.target === instruction) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const selected = event.target instanceof Element ? event.target : hoveredElement;
    if (!selected) return;

    const result = await saveSelectedElement(selected);
    if (!result.ok) showNotice(result.error, true);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') stopPicker();
  }

  function showNotice(text, isError = false) {
    const notice = document.createElement('div');
    notice.textContent = text;
    Object.assign(notice.style, {
      position: 'fixed',
      zIndex: '2147483647',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '10px 16px',
      borderRadius: '8px',
      background: isError ? '#b42318' : '#17211d',
      color: '#fff',
      font: '14px/1.4 system-ui, sans-serif',
    });
    document.documentElement.append(notice);
    setTimeout(() => notice.remove(), 4000);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'START_SELECTION') return false;

    const selector = typeof message.selector === 'string' ? message.selector.trim() : '';
    if (selector) {
      let selected;
      try {
        selected = document.querySelector(selector);
      } catch {
        sendResponse({ ok: false, error: 'O seletor CSS é inválido. Confira o texto e tente novamente.' });
        return false;
      }

      if (!selected) {
        sendResponse({ ok: false, error: 'Nenhum elemento corresponde a esse seletor nesta página.' });
        return false;
      }

      saveSelectedElement(selected).then(sendResponse);
      return true;
    }

    active = true;
    document.documentElement.append(instruction, highlight);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    sendResponse({ ok: true });
    return false;
  });
})();
