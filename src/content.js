/**
 * Content script.
 *
 * Duas responsabilidades, as duas dentro da própria página:
 * 1. escolher elementos, destacando o que estiver sob o cursor;
 * 2. montar as páginas e abrir a janela de impressão — sem abrir aba nenhuma.
 */

import { captureElement } from './shared/capture.js';
import {
  OVERLAY_ATTRIBUTE,
  PRINT_ROOT_ID,
  PRINT_STYLE_ID,
  buildPageSizeStyle,
  buildPrintRoot,
  removePrintArtifacts,
} from './shared/print-sheets.js';
import { MESSAGE } from './shared/messages.js';
import { t } from './shared/i18n.js';

if (!globalThis.__elementPdfPickerLoaded) {
  globalThis.__elementPdfPickerLoaded = true;
  installPicker();
}

function installPicker() {
  const OVERLAY_Z_INDEX = '2147483647';
  const BASE_OVERLAY_STYLE = {
    position: 'fixed',
    zIndex: OVERLAY_Z_INDEX,
    pointerEvents: 'none',
    font: '14px/1.4 system-ui, sans-serif',
  };

  let active = false;
  let busy = false;
  /** @type {Element | null} */
  let hoveredElement = null;
  /** Avisos ainda na tela, para poderem sair antes da impressão. @type {Set<Element>} */
  const notices = new Set();

  const highlight = document.createElement('div');
  Object.assign(highlight.style, BASE_OVERLAY_STYLE, {
    border: '2px solid #19a66a',
    background: 'rgba(25, 166, 106, 0.12)',
    boxSizing: 'border-box',
    display: 'none',
  });
  highlight.setAttribute('aria-hidden', 'true');
  highlight.setAttribute(OVERLAY_ATTRIBUTE, '');

  const instruction = document.createElement('div');
  Object.assign(instruction.style, BASE_OVERLAY_STYLE, {
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 16px',
    borderRadius: '8px',
    background: '#17211d',
    color: '#fff',
    boxShadow: '0 2px 12px rgba(0,0,0,.25)',
  });
  instruction.setAttribute(OVERLAY_ATTRIBUTE, '');
  instruction.textContent = t('pickerInstruction');

  /**
   * Resolve o elemento sob um ponto da viewport. Tanto o destaque quanto o
   * clique passam por aqui, para que nunca divirjam sobre qual é o alvo.
   *
   * @param {number} clientX
   * @param {number} clientY
   * @returns {Element | null}
   */
  function elementAtPoint(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!target || target === highlight || target === instruction) return null;
    if (target.id === PRINT_ROOT_ID || target.closest?.(`#${PRINT_ROOT_ID}`)) return null;
    return target;
  }

  function startPicker() {
    if (active) return;
    active = true;
    document.documentElement.append(instruction, highlight);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function stopPicker() {
    active = false;
    hoveredElement = null;
    highlight.style.display = 'none';
    highlight.remove();
    instruction.remove();
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  /** @param {MouseEvent} event */
  function onMouseMove(event) {
    const target = elementAtPoint(event.clientX, event.clientY);
    if (!target || target === hoveredElement) return;

    hoveredElement = target;
    const rect = target.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  /**
   * Devolve o controle ao navegador por dois quadros, para que o aviso de
   * progresso seja efetivamente pintado antes da captura — que, em elementos
   * grandes, bloqueia a thread por segundos.
   *
   * @returns {Promise<void>}
   */
  function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  /**
   * Captura o elemento e entrega a página pronta ao painel lateral.
   *
   * @param {Element} selected
   * @returns {Promise<void>}
   */
  async function capturePage(selected) {
    if (busy) return;
    busy = true;

    const progress = showNotice(t('pickerPreparing'), false, 0);
    try {
      await nextPaint();
      const page = pageFrom(selected);
      if (!page) throw new Error(t('errEmptyCapture'));

      await chrome.runtime.sendMessage({ type: MESSAGE.PAGE_CAPTURED, page });
      showNotice(t('pickerAdded'), false, 1600);
    } catch (error) {
      showNotice(error.message || t('errPreparePdf'), true);
    } finally {
      busy = false;
      progress.remove();
    }
  }

  /**
   * @param {Element} element
   * @returns {string}
   */
  function labelFor(element) {
    const text = element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40);
    return text || element.tagName.toLowerCase();
  }

  /** @param {MouseEvent} event */
  async function onClick(event) {
    if (!active) return;
    const selected = elementAtPoint(event.clientX, event.clientY) || hoveredElement;
    if (!selected) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // O seletor continua ativo: adicionar várias páginas seguidas é o caso
    // comum, e sair a cada clique obrigaria a voltar ao painel toda vez.
    await capturePage(selected);
  }

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.key !== 'Escape' || busy) return;
    stopPicker();
    void chrome.runtime.sendMessage({ type: MESSAGE.PICK_CANCELLED });
  }

  /**
   * @param {string} text
   * @param {boolean} [isError]
   * @param {number} [autoHideMs] `0` mantém o aviso até ser removido à mão
   * @returns {{ remove: () => void }}
   */
  function showNotice(text, isError = false, autoHideMs = 4000) {
    const notice = document.createElement('div');
    notice.textContent = text;
    notice.setAttribute('role', isError ? 'alert' : 'status');
    notice.setAttribute(OVERLAY_ATTRIBUTE, '');
    Object.assign(notice.style, BASE_OVERLAY_STYLE, {
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '10px 16px',
      borderRadius: '8px',
      background: isError ? '#b42318' : '#17211d',
      color: '#fff',
      boxShadow: '0 2px 12px rgba(0,0,0,.25)',
    });
    document.documentElement.append(notice);
    notices.add(notice);

    const remove = () => {
      notices.delete(notice);
      notice.remove();
    };
    const timer = autoHideMs > 0 ? setTimeout(remove, autoHideMs) : null;
    return {
      setText: (novo) => {
        notice.textContent = novo;
      },
      remove: () => {
        if (timer) clearTimeout(timer);
        remove();
      },
    };
  }

  /**
   * Monta as folhas dentro da página, prontas para serem capturadas.
   *
   * Quem gera o PDF é o service worker, com `Page.printToPDF`: a janela de
   * impressão do Chrome escolhe um papel só para o trabalho inteiro, então por
   * ela as páginas nunca acompanhariam o tamanho de cada elemento.
   *
   * @param {import('./shared/storage.js').CapturedPage[]} pages
   * @returns {Promise<void>}
   */
  async function renderSheets(pages) {
    // Os avisos ficam pendurados em `documentElement`, fora do `body`: se
    // sobrarem, aparecem impressos no topo da primeira página.
    clearNotices();
    stopPicker();
    removePrintArtifacts();
    if (pages.length === 0) return;

    // As regras `@page` precisam vir de folha de autor: o Chrome ignora `@page`
    // de origem de usuário ao decidir o tamanho das páginas, e é de lá que vem o
    // resto do CSS da impressão.
    const style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    style.textContent = buildPageSizeStyle(pages);
    document.head.append(style);

    const root = buildPrintRoot(pages);
    document.body.append(root);
    await waitForImages(root);
  }

  /**
   * Espera as imagens das folhas, com um teto para que uma imagem que nunca
   * resolve não trave a impressão.
   *
   * @param {ParentNode} root
   * @param {number} [timeoutMs]
   * @returns {Promise<void>}
   */
  async function waitForImages(root, timeoutMs = 10000) {
    const pending = [...root.querySelectorAll('img')]
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          }),
      );

    if (pending.length === 0) return;
    await Promise.race([
      Promise.all(pending),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /** Altura, em px, dentro da qual dois elementos contam como da mesma linha. */
  const ROW_TOLERANCE = 8;

  /**
   * Ordena os elementos como aparecem na tela: de cima para baixo e, dentro de
   * uma mesma faixa horizontal, da esquerda para a direita.
   *
   * A ordem do documento quase sempre coincide, mas não quando o layout
   * reordena (flex com `order`, grid, posicionamento absoluto). As coordenadas
   * são absolutas no documento, não da viewport, para não dependerem da rolagem.
   *
   * @param {Element[]} elements
   * @returns {Element[]}
   */
  function inScreenOrder(elements) {
    return elements
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          element,
          index,
          row: Math.round((rect.top + window.scrollY) / ROW_TOLERANCE),
          left: rect.left + window.scrollX,
        };
      })
      .sort((a, b) => a.row - b.row || a.left - b.left || a.index - b.index)
      .map((entry) => entry.element);
  }

  /** Diferença relativa de proporção tolerada entre a caixa e a imagem. */
  const ASPECT_TOLERANCE = 0.01;

  /**
   * Devolve a URL da imagem quando o elemento é uma imagem "limpa", isto é,
   * quando desenhar só o arquivo original no lugar dela dá o mesmo resultado.
   *
   * Nesses casos o PDF pode embutir o JPEG/PNG como está, em vez de passar pelo
   * mecanismo de impressão — que parte do bitmap decodificado e o re-codifica
   * sem perdas, inflando o arquivo em várias vezes.
   *
   * Exige que não haja nada em volta (borda, padding, arredondamento, sombra,
   * filtro, transparência) e que a caixa tenha a mesma proporção da imagem, o
   * que descarta recortes por `object-fit`.
   *
   * @param {Element} element
   * @returns {string | null}
   */
  function plainImageSource(element) {
    if (!(element instanceof HTMLImageElement)) return null;

    const url = element.currentSrc || element.src;
    if (!url) return null;
    if (!element.naturalWidth || !element.naturalHeight) return null;

    const computed = getComputedStyle(element);
    const espessuras = [
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
      'borderBottomLeftRadius',
    ];
    if (espessuras.some((nome) => Number.parseFloat(computed[nome]) > 0)) return null;
    if (computed.boxShadow !== 'none' || computed.filter !== 'none') return null;
    if (computed.opacity !== '1' || computed.mixBlendMode !== 'normal') return null;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    // Proporção diferente significa recorte ou distorção: o arquivo original
    // desenhado na caixa inteira não reproduziria o que está na tela.
    const caixa = rect.width / rect.height;
    const natural = element.naturalWidth / element.naturalHeight;
    if (Math.abs(caixa - natural) / natural > ASPECT_TOLERANCE) return null;

    return url;
  }

  /**
   * @param {Element} element
   * @returns {import('./shared/storage.js').CapturedPage | null}
   */
  function pageFrom(element) {
    const html = captureElement(element);
    if (!html) return null;

    const rect = element.getBoundingClientRect();
    const imageUrl = plainImageSource(element);
    return {
      id: crypto.randomUUID(),
      label: labelFor(element),
      html,
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(Math.max(rect.height, element.scrollHeight))),
      ...(imageUrl ? { imageUrl } : {}),
    };
  }

  /**
   * Captura de uma vez tudo o que casar com um seletor CSS, uma página por
   * elemento.
   *
   * As páginas vão numa mensagem só: enviar uma por uma faria o service worker
   * reescrever o registro inteiro a cada elemento, o que cresce com o quadrado
   * da quantidade.
   *
   * @param {unknown} rawSelector
   * @returns {Promise<number>} quantas páginas foram adicionadas
   */
  async function captureBySelector(rawSelector) {
    const selector = typeof rawSelector === 'string' ? rawSelector.trim() : '';
    if (!selector) throw new Error(t('errInvalidSelector'));
    if (busy) throw new Error(t('errPreparePdf'));

    let matches;
    try {
      matches = [...document.querySelectorAll(selector)];
    } catch {
      throw new Error(t('errInvalidSelector'));
    }

    // Elementos sem caixa não rendem página nenhuma.
    const visible = matches.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (visible.length === 0) throw new Error(t('errNoMatch'));

    busy = true;
    const ordered = inScreenOrder(visible);
    const progress = showNotice(t('pickerBatchProgress', [0, ordered.length]), false, 0);

    try {
      /** @type {import('./shared/storage.js').CapturedPage[]} */
      const pages = [];
      for (const [index, element] of ordered.entries()) {
        progress.setText(t('pickerBatchProgress', [index + 1, ordered.length]));
        await nextPaint();
        const page = pageFrom(element);
        if (page) pages.push(page);
      }

      if (pages.length === 0) throw new Error(t('errEmptyCapture'));
      await chrome.runtime.sendMessage({ type: MESSAGE.PAGES_CAPTURED, pages });
      showNotice(t('pickerBatchAdded', [pages.length]), false, 2400);
      return pages.length;
    } finally {
      busy = false;
      progress.remove();
    }
  }

  /**
   * Converte bytes em base64 em blocos.
   *
   * `String.fromCharCode(...bytes)` de uma vez estoura a pilha em arquivos de
   * algumas centenas de KB.
   *
   * @param {ArrayBuffer} buffer
   * @returns {string}
   */
  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + CHUNK));
    }
    return btoa(binary);
  }

  /**
   * @param {Uint8Array} head
   * @returns {'jpeg' | 'png' | null}
   */
  function imageFormat(head) {
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (PNG.every((byte, index) => head[index] === byte)) return 'png';
    return null;
  }

  /**
   * Indica se o PNG tem canal alfa ou paleta — casos em que virar JPEG trocaria
   * a transparência por preto.
   *
   * O tipo de cor fica no byte 25, dentro do cabeçalho IHDR: 3 é paleta (que
   * pode ter transparência em `tRNS`), 4 e 6 têm alfa.
   *
   * @param {Uint8Array} bytes
   * @returns {boolean}
   */
  function pngHasAlpha(bytes) {
    const colorType = bytes[25];
    return colorType === 3 || colorType === 4 || colorType === 6;
  }

  /**
   * Reamostra a imagem para caber na largura alvo e a recodifica.
   *
   * @param {Blob} blob
   * @param {number | null} maxWidth `null` mantém a resolução original
   * @param {number} quality
   * @param {boolean} keepAlpha
   * @returns {Promise<{ base64: string, type: 'jpeg' | 'png' }>}
   */
  async function resampleImage(blob, maxWidth, quality, keepAlpha) {
    const bitmap = await createImageBitmap(blob);
    try {
      // Nunca ampliar: aumentar os pixels só aumentaria o arquivo.
      const scale = maxWidth ? Math.min(1, maxWidth / bitmap.width) : 1;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error(t('errEmptyCapture'));
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);

      const type = keepAlpha ? 'png' : 'jpeg';
      const encoded = await canvas.convertToBlob({ type: `image/${type}`, quality });
      return { base64: toBase64(await encoded.arrayBuffer()), type };
    } finally {
      bitmap.close();
    }
  }

  /**
   * Traz os bytes de uma imagem da página, prontos para irem para o PDF.
   *
   * A busca é feita aqui, e não no service worker, porque o content script
   * compartilha a origem e os cookies da página — e a imagem quase sempre já
   * está no cache.
   *
   * Sem reamostragem pedida, JPEG e PNG voltam como estão, preservando a
   * compressão original; outros formatos (WebP, AVIF) o PDF não aceita, então
   * são convertidos a partir dos bytes já baixados, sem passar por um canvas
   * contaminável.
   *
   * @param {{ url?: unknown, maxWidth?: unknown, quality?: unknown }} request
   * @returns {Promise<{ base64: string, type: 'jpeg' | 'png' }>}
   */
  async function fetchImageBytes(request) {
    const url = typeof request?.url === 'string' ? request.url : '';
    if (!url) throw new Error(t('errEmptyCapture'));

    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(t('errEmptyCapture'));

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const format = imageFormat(bytes.subarray(0, 8));

    const maxWidth = Number(request?.maxWidth) || null;
    const quality = Number(request?.quality) || 0.85;
    const keepAlpha = format === 'png' && pngHasAlpha(bytes);

    if (!maxWidth) {
      // Nada a reamostrar: só converter o que o PDF não aceita.
      if (format) return { base64: toBase64(buffer), type: format };
      return resampleImage(blob, null, quality, false);
    }

    // Reamostrar não compensa se a imagem já é menor que o alvo e o formato
    // serve: recodificar perderia qualidade sem ganhar bytes.
    const bitmapWidth = await imageWidth(blob);
    if (format && bitmapWidth <= maxWidth) {
      return { base64: toBase64(buffer), type: format };
    }

    return resampleImage(blob, maxWidth, quality, keepAlpha);
  }

  /**
   * @param {Blob} blob
   * @returns {Promise<number>}
   */
  async function imageWidth(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      return bitmap.width;
    } finally {
      bitmap.close();
    }
  }

  /** Tira da tela todos os avisos ainda visíveis. */
  function clearNotices() {
    for (const notice of notices) notice.remove();
    notices.clear();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === MESSAGE.START_SELECTION) {
      startPicker();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === MESSAGE.STOP_SELECTION) {
      stopPicker();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === MESSAGE.CAPTURE_SELECTOR) {
      captureBySelector(message.selector).then(
        (count) => sendResponse({ ok: true, count }),
        (error) => sendResponse({ ok: false, error: error.message }),
      );
      return true;
    }

    if (message?.type === MESSAGE.FETCH_IMAGE) {
      fetchImageBytes(message).then(
        (data) => sendResponse({ ok: true, ...data }),
        (error) => sendResponse({ ok: false, error: error.message }),
      );
      return true;
    }

    if (message?.type === MESSAGE.RENDER_SHEETS) {
      renderSheets(Array.isArray(message.pages) ? message.pages : []).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: error.message }),
      );
      return true;
    }

    if (message?.type === MESSAGE.CLEANUP_SHEETS) {
      removePrintArtifacts();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
}
