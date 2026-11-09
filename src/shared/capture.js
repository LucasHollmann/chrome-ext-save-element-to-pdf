/**
 * Captura de um elemento da página para HTML autossuficiente.
 *
 * O clone precisa sobreviver fora da página de origem, sem as folhas de
 * estilo dela, então os estilos computados são embutidos. Para não inflar o
 * HTML em ordens de magnitude (um elemento tem ~340 propriedades computadas),
 * só é gravada a propriedade que difere do padrão do agente de usuário para
 * aquela tag e, no caso de propriedades herdadas, do valor que o elemento-pai
 * já carrega.
 */

import {
  BLOCKED_TAGS,
  URL_ATTRIBUTES,
  isUnsafeAttributeName,
  isUnsafeUrl,
  resolveSrcset,
  resolveUrl,
} from './sanitize.js';

/**
 * Propriedades posicionais: o clone é reancorado em outro documento, então
 * reproduzi-las quebraria o layout da página de impressão.
 */
const EXCLUDED_PROPERTIES = new Set([
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'transform',
  'perspective',
  'view-transition-name',
  'anchor-name',
  'content-visibility',
  // Altura computada: fixá-la cortaria o texto que reflui numa página de
  // largura diferente da original. A largura fica, porque é ela que define o
  // layout; a altura deve seguir o conteúdo.
  'height',
  'block-size',
  'min-height',
  'min-block-size',
]);

/**
 * Propriedades herdadas. Quando o valor do filho é igual ao do pai, ele é
 * omitido: o pai já o grava explicitamente e a herança faz o resto.
 */
const INHERITED_PROPERTIES = new Set([
  'border-collapse',
  'border-spacing',
  'caption-side',
  'color',
  'cursor',
  'direction',
  'empty-cells',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-variant-caps',
  'font-variant-east-asian',
  'font-variant-ligatures',
  'font-variant-numeric',
  'font-weight',
  'hyphens',
  'letter-spacing',
  'line-height',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'orphans',
  'overflow-wrap',
  'paint-order',
  'quotes',
  'tab-size',
  'text-align',
  'text-align-last',
  'text-indent',
  'text-rendering',
  'text-shadow',
  'text-transform',
  'text-underline-position',
  'visibility',
  'white-space',
  'widows',
  'word-break',
  'word-spacing',
  'writing-mode',
]);

/** Atributos de URL que aceitam lista de candidatos. */
const SRCSET_ATTRIBUTES = new Set(['srcset', 'imagesrcset']);

/** Elementos vazios, que não têm filhos a percorrer. */
const VOID_TAGS = new Set([
  'AREA',
  'BASE',
  'BR',
  'COL',
  'EMBED',
  'HR',
  'IMG',
  'INPUT',
  'LINK',
  'META',
  'SOURCE',
  'TRACK',
  'WBR',
]);

/**
 * Cria um documento isolado para medir os padrões do agente de usuário.
 * O iframe fica fora da viewport, mas renderizado — `display: none` faria o
 * Chrome devolver estilos computados vazios.
 *
 * @returns {{ document: Document, dispose: () => void }}
 */
function createDefaultsSandbox() {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed;left:-99999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
  document.documentElement.append(frame);
  const sandboxDocument = frame.contentDocument;
  return {
    document: sandboxDocument,
    dispose: () => frame.remove(),
  };
}

/**
 * Lê (com cache) os estilos padrão de uma tag dentro do sandbox.
 *
 * @param {{ document: Document | null }} sandbox
 * @param {Map<string, Map<string, string>>} cache
 * @param {string} tagName
 * @returns {Map<string, string>}
 */
function defaultStylesFor(sandbox, cache, tagName) {
  const cached = cache.get(tagName);
  if (cached) return cached;

  const styles = new Map();
  const sandboxDocument = sandbox.document;
  if (sandboxDocument) {
    let probe = null;
    try {
      probe = sandboxDocument.createElement(tagName);
      // Alguns elementos só são renderizados dentro do pai correto (td, li…).
      sandboxDocument.body.append(probe);
      const computed = sandboxDocument.defaultView.getComputedStyle(probe);
      for (const property of computed) {
        styles.set(property, computed.getPropertyValue(property));
      }
    } catch {
      // Tag desconhecida ou sandbox indisponível: sem padrões, grava tudo.
    } finally {
      probe?.remove();
    }
  }

  cache.set(tagName, styles);
  return styles;
}

/**
 * Embute no clone apenas as propriedades que realmente precisam viajar.
 *
 * @param {CSSStyleDeclaration} computed estilos computados da origem
 * @param {HTMLElement | SVGElement} clone
 * @param {Map<string, string>} defaults padrões do agente de usuário
 * @param {CSSStyleDeclaration | null} parentComputed estilos do pai de origem
 * @param {boolean} isRoot
 */
function inlineComputedStyles(computed, clone, defaults, parentComputed, isRoot) {
  for (const property of computed) {
    if (EXCLUDED_PROPERTIES.has(property)) continue;

    const value = computed.getPropertyValue(property);
    const inherited = INHERITED_PROPERTIES.has(property) || property.startsWith('--');

    // Na raiz, propriedades herdadas são sempre gravadas: a página de
    // impressão tem fonte e cor próprias, que vazariam para dentro do clone.
    if (!(isRoot && inherited) && defaults.get(property) === value) continue;
    if (!isRoot && inherited && parentComputed?.getPropertyValue(property) === value) continue;

    clone.style.setProperty(property, value, computed.getPropertyPriority(property));
  }
}

/**
 * Copia atributos aplicando a política de segurança e resolvendo URLs
 * relativas contra a página de origem.
 *
 * @param {Element} source
 * @param {Element} clone
 * @param {string} baseUrl
 */
function copyAttributes(source, clone, baseUrl) {
  for (const attribute of source.attributes) {
    const name = attribute.name;
    const lowered = name.toLowerCase();
    if (lowered === 'style' || isUnsafeAttributeName(lowered)) continue;
    // `class` não tem função no clone: todo estilo já está embutido. Carregá-la
    // só daria às folhas do site um gancho para alcançar o clone na impressão.
    // `id` fica, porque SVG o usa em referências internas (gradientes, `use`).
    if (lowered === 'class') continue;

    if (SRCSET_ATTRIBUTES.has(lowered)) {
      const resolved = resolveSrcset(attribute.value, baseUrl);
      if (resolved) clone.setAttribute(name, resolved);
      continue;
    }

    if (URL_ATTRIBUTES.has(lowered)) {
      if (isUnsafeUrl(attribute.value)) continue;
      const resolved = resolveUrl(attribute.value, baseUrl);
      if (resolved !== null) clone.setAttribute(name, resolved);
      continue;
    }

    clone.setAttribute(name, attribute.value);
  }
}

/**
 * Congela o estado atual de campos de formulário nos atributos, já que o PDF
 * não roda JavaScript e o valor digitado não está no HTML.
 *
 * @param {Element} source
 * @param {Element} clone
 */
function freezeFormState(source, clone) {
  if (source instanceof HTMLInputElement) {
    if (source.type === 'checkbox' || source.type === 'radio') {
      if (source.checked) clone.setAttribute('checked', '');
      else clone.removeAttribute('checked');
    } else {
      clone.setAttribute('value', source.value);
    }
  } else if (source instanceof HTMLTextAreaElement) {
    clone.textContent = source.value;
  } else if (source instanceof HTMLOptionElement) {
    if (source.selected) clone.setAttribute('selected', '');
    else clone.removeAttribute('selected');
  }
}

/**
 * Converte um `<canvas>` em imagem. Sem isso o canvas sai em branco, porque o
 * bitmap não faz parte do HTML.
 *
 * @param {HTMLCanvasElement} source
 * @param {CSSStyleDeclaration} computed
 * @returns {HTMLElement}
 */
function canvasToImage(source, computed) {
  const rect = source.getBoundingClientRect();
  let dataUrl = '';
  try {
    dataUrl = source.toDataURL('image/png');
  } catch {
    // Canvas contaminado por imagem de outra origem: não há bitmap legível.
  }

  if (!dataUrl) {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = `width:${Math.round(rect.width)}px;height:${Math.round(
      rect.height,
    )}px;background:${computed.backgroundColor || 'transparent'};`;
    return placeholder;
  }

  const image = document.createElement('img');
  image.src = dataUrl;
  image.width = Math.round(rect.width) || source.width;
  image.height = Math.round(rect.height) || source.height;
  return image;
}

/**
 * Extrai o texto declarado em `content` de um pseudo-elemento.
 * Só são reproduzidos valores literais; `attr()`, `counter()` e imagens
 * geradas dependem de contexto que não sobrevive ao clone.
 *
 * @param {string} content
 * @returns {string | null}
 */
export function pseudoContentToText(content) {
  const value = String(content).trim();
  if (!value || value === 'none' || value === 'normal') return null;
  if (/\b(attr|counter|counters|url|image-set|linear-gradient)\s*\(/.test(value)) return null;

  const quoted = value.match(/^"((?:[^"\\]|\\.)*)"$|^'((?:[^'\\]|\\.)*)'$/);
  if (!quoted) return null;
  return (quoted[1] ?? quoted[2]).replace(/\\([\da-f]{1,6})\s?/gi, (_, code) =>
    String.fromCodePoint(Number.parseInt(code, 16)),
  );
}

/**
 * Materializa `::before`/`::after` como elementos reais, já que pseudo-elementos
 * não existem no clone.
 *
 * @param {Element} source
 * @param {'::before' | '::after'} pseudo
 * @returns {HTMLElement | null}
 */
function buildPseudoElement(source, pseudo) {
  const computed = getComputedStyle(source, pseudo);
  const text = pseudoContentToText(computed.getPropertyValue('content'));
  if (text === null) return null;

  const span = document.createElement('span');
  span.textContent = text;
  for (const property of computed) {
    if (EXCLUDED_PROPERTIES.has(property) || property === 'content') continue;
    span.style.setProperty(property, computed.getPropertyValue(property));
  }
  return span;
}

/**
 * Constrói recursivamente o clone de um nó.
 *
 * Diferente de `cloneNode(true)` + varredura por índice, a árvore é montada
 * nó a nó: assim shadow DOM, pseudo-elementos e canvas podem alterar a
 * estrutura sem desalinhar a correspondência entre origem e clone.
 *
 * @param {Node} source
 * @param {object} context
 * @param {string} context.baseUrl
 * @param {{ document: Document | null }} context.sandbox
 * @param {Map<string, Map<string, string>>} context.defaultsCache
 * @param {Map<Element, Element>} context.cloneBySource
 * @param {CSSStyleDeclaration | null} parentComputed
 * @param {boolean} isRoot
 * @returns {Node | null}
 */
function buildClone(source, context, parentComputed, isRoot) {
  if (source.nodeType === Node.TEXT_NODE) {
    return source.data.trim() || /\s/.test(source.data)
      ? document.createTextNode(source.data)
      : null;
  }

  if (source.nodeType !== Node.ELEMENT_NODE) return null;
  if (BLOCKED_TAGS.has(source.tagName)) return null;

  const computed = getComputedStyle(source);
  // `display: none` não ocupa espaço na página nem no PDF.
  if (!isRoot && computed.display === 'none') return null;

  if (source instanceof HTMLCanvasElement) {
    return canvasToImage(source, computed);
  }

  let clone;
  try {
    clone = document.createElementNS(source.namespaceURI, source.tagName.toLowerCase());
  } catch {
    clone = document.createElement('div');
  }

  copyAttributes(source, clone, context.baseUrl);
  freezeFormState(source, clone);
  context.cloneBySource.set(source, clone);

  if (clone instanceof HTMLElement || clone instanceof SVGElement) {
    const defaults = defaultStylesFor(context.sandbox, context.defaultsCache, source.tagName);
    inlineComputedStyles(computed, clone, defaults, parentComputed, isRoot);
  }

  if (VOID_TAGS.has(source.tagName)) return clone;

  const before = buildPseudoElement(source, '::before');
  if (before) clone.append(before);

  // Um shadow root aberto substitui a renderização da light DOM.
  const children = source.shadowRoot ? source.shadowRoot.childNodes : source.childNodes;
  for (const child of children) {
    const childClone = buildClone(child, context, computed, false);
    if (childClone) clone.append(childClone);
  }

  const after = buildPseudoElement(source, '::after');
  if (after) clone.append(after);

  return clone;
}

/**
 * Indica se margens podem atravessar a borda de cima (ou de baixo) do elemento
 * e colapsar com as do pai, saindo da caixa dele.
 *
 * @param {CSSStyleDeclaration} computed
 * @param {'start' | 'end'} side
 * @returns {boolean}
 */
function collapsesThrough(computed, side) {
  if (computed.display !== 'block') return false;
  if (computed.float !== 'none') return false;
  if (computed.position === 'absolute' || computed.position === 'fixed') return false;
  // `overflow` diferente de `visible` cria um contexto que contém as margens.
  if (computed.overflowY !== 'visible') return false;

  const border = side === 'start' ? computed.borderTopWidth : computed.borderBottomWidth;
  const padding = side === 'start' ? computed.paddingTop : computed.paddingBottom;
  return Number.parseFloat(border) === 0 && Number.parseFloat(padding) === 0;
}

/**
 * Primeiro (ou último) filho que gera caixa no fluxo normal.
 *
 * Devolve `null` quando o conteúdo da borda é texto: uma linha de texto
 * interrompe o colapso.
 *
 * @param {Element} source
 * @param {'start' | 'end'} side
 * @returns {Element | null}
 */
function inFlowEdgeChild(source, side) {
  const nodes = [...source.childNodes];
  if (side === 'end') nodes.reverse();

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.data.trim()) return null;
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const computed = getComputedStyle(node);
    if (computed.display === 'none') continue;
    if (computed.position === 'absolute' || computed.position === 'fixed') continue;
    if (computed.float !== 'none') continue;
    return /** @type {Element} */ (node);
  }

  return null;
}

/**
 * Zera as margens que, na página de origem, escapavam da caixa do elemento por
 * colapso.
 *
 * A folha de impressão tem o tamanho exato do elemento, medido com
 * `getBoundingClientRect()`, que não inclui essas margens. Se elas viessem
 * junto, reapareceriam dentro da folha — empurrando o conteúdo para baixo e
 * cortando o fim. O colapso encadeia, então a varredura desce pela borda
 * enquanto cada nível puder deixar a margem passar.
 *
 * @param {Element} element
 * @param {Map<Element, Element>} cloneBySource
 */
function suppressCollapsedEdgeMargins(element, cloneBySource) {
  for (const side of /** @type {const} */ (['start', 'end'])) {
    const property = side === 'start' ? 'margin-top' : 'margin-bottom';
    let current = element;

    while (current && collapsesThrough(getComputedStyle(current), side)) {
      const child = inFlowEdgeChild(current, side);
      if (!child) break;

      cloneBySource.get(child)?.style.setProperty(property, '0', 'important');
      current = child;
    }
  }
}

/**
 * Captura um elemento como HTML autossuficiente.
 *
 * @param {Element} element
 * @param {{ baseUrl?: string }} [options]
 * @returns {string} HTML do elemento, com estilos embutidos
 */
export function captureElement(element, options = {}) {
  const baseUrl = options.baseUrl || document.baseURI;
  const sandbox = createDefaultsSandbox();

  const cloneBySource = new Map();

  try {
    const clone = buildClone(
      element,
      { baseUrl, sandbox, defaultsCache: new Map(), cloneBySource },
      element.parentElement ? getComputedStyle(element.parentElement) : null,
      true,
    );

    if (!(clone instanceof Element)) return '';

    suppressCollapsedEdgeMargins(element, cloneBySource);

    // O elemento vira a raiz do documento impresso: nada de deslocamentos
    // herdados da posição que ele ocupava na página de origem.
    clone.style.setProperty('position', 'static', 'important');
    clone.style.setProperty('inset', 'auto', 'important');
    clone.style.setProperty('max-width', '100%', 'important');
    clone.style.setProperty('max-height', 'none', 'important');
    clone.style.setProperty('transform', 'none', 'important');
    return clone.outerHTML;
  } finally {
    sandbox.dispose();
  }
}
