/**
 * Montagem das folhas de impressão dentro da própria página.
 *
 * Fica em módulo próprio, fora do closure do content script, por dois motivos:
 * o service worker precisa do CSS para injetá-lo com `scripting.insertCSS`, e é
 * a parte cujo resultado só aparece no PDF, onde um erro sai caro.
 */

import { sanitizeTree } from './sanitize.js';

/** Id do contêiner que recebe as folhas. */
export const PRINT_ROOT_ID = '__salvar-elemento-pdf-impressao__';

/**
 * Atributo que marca as sobreposições da extensão na página (destaque do
 * seletor, instrução e avisos). Elas ficam penduradas em `documentElement`,
 * fora do `body`, então não são alcançadas pela regra que esconde os irmãos do
 * contêiner — e apareciam impressas no topo da primeira página.
 */
export const OVERLAY_ATTRIBUTE = 'data-salvar-elemento-pdf-overlay';

/** Id da folha de estilo, de autor, que carrega as regras `@page`. */
export const PRINT_STYLE_ID = '__salvar-elemento-pdf-estilo__';

/**
 * Nome da página CSS de uma folha.
 *
 * @param {number} index base zero
 * @returns {string}
 */
function pageName(index) {
  return `pdf-page-${index + 1}`;
}

/**
 * Só as regras `@page`, para irem numa folha de estilo de autor.
 *
 * O Chrome ignora `@page` vindo de folha de origem de usuário ao resolver o
 * tamanho das páginas — e é por `insertCSS({ origin: 'USER' })` que vai o resto
 * do CSS, que precisa daquela origem para vencer o `!important` do site. Então
 * as duas coisas viajam separadas: o tamanho das páginas como autor, as
 * sobreposições como usuário.
 *
 * @param {import('./storage.js').CapturedPage[]} pages
 * @returns {string}
 */
export function buildPageSizeStyle(pages) {
  if (pages.length === 0) return '';

  const rules = pages.map(
    (page, index) =>
      `@page ${pageName(index)} { size: ${page.width}px ${page.height}px; margin: 0; }`,
  );

  // A regra sem nome define o papel padrão; as nomeadas, o de cada folha.
  rules.unshift(`@page { size: ${pages[0].width}px ${pages[0].height}px; margin: 0; }`);
  return rules.join('\n');
}

/**
 * Folha de estilo que transforma a página numa pilha de folhas na impressão.
 *
 * Imprimir a partir da própria aba evita abrir uma tela separada, mas exige
 * neutralizar o que o site define para `@media print` — daí os `!important`.
 *
 * Toda regra que mexe em `html`/`body` é condicionada à presença do contêiner,
 * com `:has()`. Assim a folha pode ficar injetada depois da impressão sem
 * afetar uma impressão normal do site mais tarde, e não é preciso removê-la.
 *
 * @param {import('./storage.js').CapturedPage[]} pages
 * @returns {string}
 */
export function buildPrintStyle(pages) {
  // Cada página recebe as dimensões do seu elemento, para o papel ter a mesma
  // proporção que ele.
  const pageRules = pages.map(
    (page, index) =>
      `@page ${pageName(index)} { size: ${page.width}px ${page.height}px; margin: 0; }`,
  );

  // A regra sem nome é a que a janela de impressão lê para escolher o papel; as
  // nomeadas valem no layout. Sem ela o diálogo fica com A4/Carta e desenha
  // cada folha, menor, centralizada no papel — com branco nos quatro lados.
  const defaultSize = pages.length > 0 ? `${pages[0].width}px ${pages[0].height}px` : 'auto';

  // O documento precisa começar já no contexto da primeira folha: sem isso, a
  // troca de página nomeada na primeira `.pdf-sheet` força uma quebra e o PDF
  // sai com uma folha em branco na frente.
  const firstPage = pages.length > 0 ? pageName(0) : 'auto';

  return `
@media print {
  @page { size: ${defaultSize}; margin: 0; }
  ${pageRules.join('\n  ')}

  html:has(#${PRINT_ROOT_ID}),
  body:has(#${PRINT_ROOT_ID}),
  #${PRINT_ROOT_ID} {
    page: ${firstPage};
    display: block !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    overflow: visible !important;
    background: white !important;
    columns: auto !important;
    column-count: auto !important;
    float: none !important;
    transform: none !important;
    zoom: 1 !important;
    visibility: visible !important;
  }

  body:has(> #${PRINT_ROOT_ID}) > *:not(#${PRINT_ROOT_ID}) {
    display: none !important;
  }

  /* Irmaos do body: e onde a extensao pendura as suas sobreposicoes. */
  html:has(#${PRINT_ROOT_ID}) > *:not(body):not(head) {
    display: none !important;
  }

  [${OVERLAY_ATTRIBUTE}] {
    display: none !important;
  }

  #${PRINT_ROOT_ID} {
    position: static !important;
  }

  #${PRINT_ROOT_ID},
  #${PRINT_ROOT_ID} * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* A quebra entre folhas vem da troca de página nomeada. Somar um
     break-after aqui duplicaria a quebra e inseriria folhas vazias. */
  #${PRINT_ROOT_ID} .pdf-sheet {
    display: block !important;
    position: static !important;
    overflow: hidden;
    box-sizing: border-box;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
  }
}

#${PRINT_ROOT_ID} {
  display: none;
}
`;
}

/**
 * Estilo que acompanha cada clone dentro do seu shadow root.
 *
 * `print-color-adjust` é herdado, então definido no host ele alcança a
 * subárvore inteira — inclusive dentro do shadow DOM.
 */
const SHADOW_STYLE = `
:host {
  display: block !important;
  width: 100% !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
`;

/**
 * Monta o contêiner com uma folha por página.
 *
 * Cada clone vai dentro de um shadow root: as folhas de estilo do site não
 * atravessam essa fronteira. Sem isolamento, uma regra do próprio site — como
 * `@media print { .cartao { display: none } }` — continuava valendo para o
 * clone, porque ele carrega as mesmas classes, e a folha saía em branco.
 *
 * @param {import('./storage.js').CapturedPage[]} pages
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function buildPrintRoot(pages, doc = document) {
  const root = doc.createElement('div');
  root.id = PRINT_ROOT_ID;
  root.setAttribute('aria-hidden', 'true');

  pages.forEach((page, index) => {
    const sheet = doc.createElement('section');
    sheet.className = 'pdf-sheet';
    sheet.style.setProperty('page', pageName(index));
    // Tamanho do elemento, igual ao da regra `@page` correspondente. Em px, e
    // não em unidades relativas: tanto `%` quanto `vw` resolvem contra a
    // primeira página, então uma folha mais estreita transbordaria e geraria
    // páginas extras.
    sheet.style.setProperty('width', `${page.width}px`, 'important');
    sheet.style.setProperty('height', `${page.height}px`, 'important');

    const element = parsePageElement(page.html, doc, page);
    if (element) {
      const holder = doc.createElement('div');
      const shadow = holder.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent = SHADOW_STYLE;
      shadow.append(style, element);
      sheet.append(holder);
    }

    root.append(sheet);
  });

  return root;
}

/**
 * Remonta o HTML guardado como elemento, sem executar nada.
 *
 * @param {string} html
 * @param {Document} doc
 * @param {import('./storage.js').CapturedPage} page
 * @returns {HTMLElement | null}
 */
function parsePageElement(html, doc, page) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const source = parsed.body.firstElementChild;
  if (!source) return null;

  const imported = /** @type {HTMLElement} */ (doc.importNode(source, true));
  sanitizeTree(imported);
  imported.style.setProperty('position', 'static', 'important');
  imported.style.setProperty('inset', 'auto', 'important');
  // A largura medida vem de `getBoundingClientRect()`, que é a caixa de borda:
  // com `content-box`, padding e borda do elemento se somariam a ela e o clone
  // ficaria mais largo que a folha.
  imported.style.setProperty('box-sizing', 'border-box', 'important');
  imported.style.setProperty('width', `${page.width}px`, 'important');
  imported.style.setProperty('max-width', 'none', 'important');
  imported.style.setProperty('margin', '0', 'important');
  imported.style.setProperty('transform', 'none', 'important');
  return imported;
}

/**
 * Remove da página o contêiner da impressão e a folha com as regras `@page`.
 * O CSS injetado por `insertCSS` fica, mas é inerte sem o contêiner: as regras
 * que mexem no documento são guardadas por `:has()`.
 *
 * @param {Document} [doc]
 */
export function removePrintArtifacts(doc = document) {
  doc.getElementById(PRINT_ROOT_ID)?.remove();
  doc.getElementById(PRINT_STYLE_ID)?.remove();
}
