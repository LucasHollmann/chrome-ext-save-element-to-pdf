# Salvar elemento em PDF

Extensão Chrome (Manifest V3) que monta um PDF a partir de elementos da página aberta. Clicar no
ícone abre o **painel lateral** na própria página: ali o usuário adiciona elementos, cada um vira
uma página, e as páginas ficam listadas em miniatura, na ordem em que serão impressas.

Não há tela de pré-visualização separada. A impressão acontece na própria aba: o content script
monta as folhas dentro da página, neutraliza o CSS de impressão do site e chama a janela de
impressão do Chrome.

## Como funciona

1. Clicar no ícone dispara `chrome.action.onClicked`, que abre o painel lateral para aquela aba.
2. **Adicionar elemento** injeta o content script e liga o seletor; o elemento sob o cursor fica
   destacado. Cada clique captura um elemento e o seletor continua ligado, porque adicionar várias
   páginas seguidas é o caso comum. **Esc** encerra.
3. A captura embute os estilos computados no HTML, para o elemento sobreviver fora da página, e é
   guardada no IndexedDB da extensão, por aba.
4. O painel mostra as páginas em miniatura e permite reordenar (arrastando ou pelas setas) e
   remover.
5. **Salvar como PDF** injeta o CSS de impressão com `scripting.insertCSS`, monta as folhas na
   página e abre a janela de impressão. Cada página sai com as dimensões do seu elemento, via uma
   regra `@page` nomeada — por isso não há seletor de retrato/paisagem: a proporção de cada página já
   vem do elemento.

As páginas pertencem à aba: fechar a aba apaga o conjunto dela, e o painel sempre mostra as páginas
da aba ativa.

## Estrutura

| Caminho                  | Papel                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| `sidepanel.html`         | Painel lateral, a única interface                                         |
| `src/sidepanel.js`       | Lista de páginas, miniaturas, ordenação e impressão                       |
| `src/content.js`         | Seletor de elementos e montagem das folhas para impressão, na própria aba |
| `src/background.js`      | Abre o painel, injeta o content script e escreve no armazenamento         |
| `src/shared/capture.js`  | Captura do elemento com os estilos computados embutidos                   |
| `src/shared/sanitize.js` | Política de tags, atributos e URLs, usada na captura e na remontagem      |
| `src/shared/storage.js`  | Páginas por aba, em IndexedDB, com coleta de órfãos                       |
| `src/manifest.config.js` | Manifest como dado; a versão vem do `package.json` no build               |
| `public/_locales/`       | Traduções (`pt_BR` padrão, `en`)                                          |
| `public/icons/`          | Ícones PNG, gerados por `npm run icons`                                   |

Toda escrita no armazenamento passa pelo service worker; o painel só lê. Com um dono só, uma captura
que chega no meio de uma reordenação não sobrescreve a outra.

### Como a página recebe a proporção do elemento

Cada folha tem uma regra `@page` nomeada com as dimensões do seu elemento, e a folha correspondente
é dimensionada nos mesmos px. Medido num PDF de quatro elementos, as páginas saem com proporções
diferentes entre si, cada uma acompanhando o seu: 564×42, 564×43, 564×17 e 504×14pt.

Três detalhes são o que fazem isso funcionar:

- **A regra `@page` sem nome é obrigatória.** É dela que a janela de impressão lê o tamanho do papel;
  as nomeadas só valem no layout. Sem ela o diálogo fica com A4/Carta, e aí _todas_ as páginas saem
  com a mesma proporção e o elemento pequeno e centralizado dentro delas. Ela recebe o tamanho da
  primeira página, porque o diálogo escolhe um papel só para o trabalho inteiro.
- **As folhas são dimensionadas em px, não em `%` nem `vw`.** As duas unidades relativas resolvem
  contra a primeira página, não contra a página corrente: com elas, uma folha mais estreita que a
  primeira transborda e gera páginas extras (seis páginas para quatro folhas, na medição).
- **Nada de tamanho inline que brigue com a folha de estilo.** Em contrapartida, o CSS injetado é de
  origem de usuário, cujo `!important` vence o do autor — então as folhas carregam o tamanho inline e
  o CSS cuida do resto.

Sobra um desvio de menos de 1px na altura: o Chrome ajusta o tamanho da página à grade de 1/300 de
polegada (0,32px). Não dá para controlar pelo CSS — usar `pt` em vez de `px` na regra `@page` dá
exatamente o mesmo resultado.

### Fidelidade da caixa capturada

A caixa que vira `viewBox` é a medida com `getBoundingClientRect()`, sem margens adicionais. Dois
detalhes garantem isso:

- **Caixa de borda no clone** — a medida inclui padding e borda. Sem `box-sizing: border-box`, os dois
  se somariam de novo à largura e o clone ficaria mais largo que a folha (36px a mais, num elemento
  com `padding: 16px` e borda de 2px).
- **Margens colapsadas suprimidas** — a margem do primeiro e do último filho escapa da caixa do
  elemento por colapso e, por isso, não entra na medida. Trazida junto, ela reaparecia dentro da
  folha: um elemento de 56px virava uma folha de 92px, com o conteúdo 18px abaixo do topo.
  `suppressCollapsedEdgeMargins`, em `capture.js`, zera só as margens que de fato escapavam —
  descendo pela borda enquanto cada nível puder deixá-las passar.

### Por que imprimir na própria aba exige três cuidados

Imprimir dentro da página do usuário dispensa a tela separada, mas põe o clone debaixo das folhas de
estilo do site. Três medidas o blindam:

1. **Shadow DOM por folha** — as regras do site não atravessam a fronteira. Sem isso, um
   `@media print { .cartao { display: none } }` do próprio site apagava o clone, que carrega as
   mesmas classes, e a folha saía em branco.
2. **`class` fora da captura** — o clone não precisa dela (todo estilo está embutido) e carregá-la só
   daria ao site um gancho a mais. O `id` fica, porque SVG o usa em referências internas.
3. **CSS na origem de usuário** — `scripting.insertCSS({ origin: 'USER' })` vence o `!important` do
   autor e não passa pelo CSP do site, ao contrário de um `<style>` criado no content script.

As regras que mexem em `html`/`body` são condicionadas por `:has(#...)` à presença do contêiner, então
a folha injetada fica inerte depois da impressão e não afeta uma impressão normal do site.

## Desenvolvimento

```sh
npm install
npm run build
```

O build roda duas vezes: a primeira gera o painel, o manifest e o service worker; a segunda empacota
o content script como IIFE, porque `chrome.scripting.executeScript({ files })` injeta scripts
clássicos, que não aceitam `import`. É isso que permite ao content script compartilhar os módulos de
`src/shared/` em vez de duplicá-los.

Para carregar no Chrome, acesse `chrome://extensions`, ative o **Modo do desenvolvedor**, clique em
**Carregar sem compactação** e selecione a pasta `dist`.

Depois de alterar os arquivos, execute `npm run build` novamente e recarregue a extensão na página
de extensões.

### Scripts

| Script                 | O que faz                                                 |
| ---------------------- | --------------------------------------------------------- |
| `npm run build`        | Gera `dist/` pronto para carregar no Chrome               |
| `npm run lint`         | ESLint                                                    |
| `npm run format`       | Prettier (`format:check` apenas verifica)                 |
| `npm test`             | Testes unitários das funções puras (`node --test`)        |
| `npm run test:browser` | Testes da captura num Chrome real                         |
| `npm run icons`        | Regenera os PNGs de `public/icons/`                       |
| `npm run check`        | Lint + formatação + testes + build, o mesmo que a CI roda |

`npm run test:browser` exercita `captureElement` num Chrome de verdade, porque ela depende de
`getComputedStyle`, pseudo-elementos, shadow DOM e `canvas.toDataURL` — nada disso é reproduzido com
fidelidade por um DOM simulado. Requer um Chrome instalado; defina `CHROME_PATH` se o seu não
estiver num caminho padrão.

### Versão e ícones

A versão existe num lugar só, o `package.json`; o `manifest.json` é emitido no build a partir de
`src/manifest.config.js`. Os ícones são PNG versionados, gerados por `scripts/generate-icons.mjs`
(o Chrome não aceita SVG em `manifest.icons`, e o projeto não carrega um rasterizador só por causa
disso).

## Limitações conhecidas

- A permissão é `activeTab`: o acesso vale para a aba em que o ícone foi clicado. Se o painel passar
  a acompanhar outra aba, é preciso clicar no ícone nela antes de adicionar elementos.
- A janela de impressão escolhe um papel só para o trabalho inteiro. Quando os elementos têm
  tamanhos diferentes, é o do primeiro que vai para a regra `@page` sem nome; o layout ainda emite
  cada página com o seu tamanho, mas se o diálogo não adotar o tamanho do CSS, todas saem no papel
  padrão com o elemento centralizado.
- O que o elemento desenha via `<iframe>`, `<object>` ou `<embed>` não é capturado: esses nós são
  removidos por segurança.
- Em pseudo-elementos, só texto literal é reproduzido. `attr()`, `counter()` e imagens geradas
  dependem de contexto que não sobrevive ao clone.
- Um `<canvas>` contaminado por imagem de outra origem não pode ser lido e vira um espaço vazio do
  mesmo tamanho.
