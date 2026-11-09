/**
 * Acesso a `chrome.i18n` com degradação graciosa.
 *
 * Os módulos compartilhados também rodam sob `node --test`, onde a API de
 * extensão não existe; nesse caso a própria chave é devolvida.
 */

/**
 * Traduz uma chave de `_locales/<lang>/messages.json`.
 *
 * @param {string} key
 * @param {(string | number)[]} [substitutions]
 * @returns {string}
 */
export function t(key, substitutions = []) {
  const message = globalThis.chrome?.i18n?.getMessage?.(key, substitutions.map(String));
  return message || key;
}

/**
 * Traduz os nós marcados no HTML. Cada atributo aceita uma lista de chaves
 * separada por vírgula, na ordem em que os destinos aparecem:
 *
 * - `data-i18n`           → `textContent`
 * - `data-i18n-attr`      → `nome:chave` (ex.: `aria-label:panelClose`)
 *
 * @param {ParentNode} [root]
 */
export function localizeDocument(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }

  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(',')) {
      const separator = pair.indexOf(':');
      if (separator < 0) continue;
      const attribute = pair.slice(0, separator).trim();
      const key = pair.slice(separator + 1).trim();
      if (attribute && key) node.setAttribute(attribute, t(key));
    }
  }
}
