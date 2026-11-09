/**
 * Única fonte de verdade para a limpeza de conteúdo capturado da página.
 * Usada tanto pelo content script (na captura) quanto pela página de
 * impressão (na reidratação do HTML), para que as duas pontas nunca
 * divirjam sobre o que é seguro.
 */

/** Tags que nunca entram no PDF (executam código ou carregam documentos). */
export const BLOCKED_TAGS = new Set([
  'SCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'LINK',
  'STYLE',
  'META',
  'BASE',
  'NOSCRIPT',
  'TEMPLATE',
]);

/** Atributos que carregam URL e por isso precisam de validação de esquema. */
export const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'poster',
  'formaction',
  'action',
  'data',
  'xlink:href',
  'ping',
]);

/** Esquemas de URL aceitos em atributos. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'mailto:', 'tel:', 'blob:']);

/** Maior ponto de código tratado como espaço/controle a ser descartado. */
const LAST_CONTROL_CODE_POINT = 0x20;

/** Espaço sem quebra, usado para disfarçar o esquema de uma URL. */
const NO_BREAK_SPACE_CODE_POINT = 0xa0;

/**
 * Indica se um atributo deve ser removido por si só, independentemente do valor.
 * Cobre handlers inline (`onclick`, `onerror`, …) e `srcdoc`.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isUnsafeAttributeName(name) {
  const lowered = name.toLowerCase();
  return lowered.startsWith('on') || lowered === 'srcdoc';
}

/**
 * Remove espaços, caracteres de controle e espaços sem quebra.
 *
 * O navegador ignora esses caracteres ao interpretar o esquema de uma URL,
 * então `java\tscript:` executa igual a `javascript:`. A filtragem é feita por
 * ponto de código, e não por expressão regular, para que o intervalo fique
 * legível sem escapes no meio de uma classe de caracteres.
 *
 * @param {string} value
 * @returns {string}
 */
function stripBlankCharacters(value) {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code <= LAST_CONTROL_CODE_POINT || code === NO_BREAK_SPACE_CODE_POINT) continue;
    result += character;
  }
  return result;
}

/**
 * Indica se o valor de um atributo de URL aponta para um esquema perigoso
 * (`javascript:`, `vbscript:`, …). Entidades HTML e espaços/controles no meio
 * do esquema são normalizados antes da checagem.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isUnsafeUrl(value) {
  const normalized = stripBlankCharacters(String(value))
    .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);?/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .toLowerCase();

  const separator = normalized.indexOf(':');
  if (separator < 0) return false;

  const scheme = `${normalized.slice(0, separator)}:`;
  // Um `:` depois de `/`, `?` ou `#` faz parte do caminho, não do esquema.
  if (scheme.includes('/') || scheme.includes('?') || scheme.includes('#')) return false;
  return !SAFE_PROTOCOLS.has(scheme);
}

/**
 * Resolve uma URL relativa contra uma base, devolvendo `null` quando o valor
 * não puder ser resolvido ou apontar para um esquema perigoso. Resolver na
 * captura evita injetar um `<base>` na página de impressão.
 *
 * @param {string} value
 * @param {string} baseUrl
 * @returns {string | null}
 */
export function resolveUrl(value, baseUrl) {
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.startsWith('#')) return trimmed || null;
  if (isUnsafeUrl(trimmed)) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Resolve cada candidato de um atributo `srcset`/`imagesrcset`.
 *
 * @param {string} value
 * @param {string} baseUrl
 * @returns {string}
 */
export function resolveSrcset(value, baseUrl) {
  return String(value)
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (!parts[0]) return '';
      const url = resolveUrl(parts[0], baseUrl);
      if (!url) return '';
      return [url, ...parts.slice(1)].join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Aplica a política de atributos a um único elemento, já existente no DOM.
 *
 * @param {Element} element
 */
export function sanitizeAttributes(element) {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (isUnsafeAttributeName(name)) {
      element.removeAttribute(attribute.name);
    } else if (URL_ATTRIBUTES.has(name) && isUnsafeUrl(attribute.value)) {
      element.removeAttribute(attribute.name);
    }
  }
}

/**
 * Remove tags bloqueadas e atributos perigosos de uma árvore já montada.
 * Idempotente: rodar duas vezes no mesmo nó não muda o resultado.
 *
 * @template {Element} T
 * @param {T} element
 * @returns {T}
 */
export function sanitizeTree(element) {
  for (const current of [element, ...element.querySelectorAll('*')]) {
    if (BLOCKED_TAGS.has(current.tagName)) {
      current.remove();
      continue;
    }
    sanitizeAttributes(current);
  }
  return element;
}
