# Salvar elemento em PDF

Extensão Chrome em React que permite selecionar um elemento da página atual e abrir uma visualização pronta para impressão. Na janela do Chrome, escolha **Salvar como PDF**.

O HTML selecionado é guardado temporariamente no IndexedDB da extensão para evitar o limite reduzido de tamanho do armazenamento de sessão do Chrome.

## Desenvolvimento

```sh
npm install
npm run build
```

Para carregar no Chrome, acesse `chrome://extensions`, ative o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione a pasta `dist`.

Depois de alterar os arquivos, execute `npm run build` novamente e recarregue a extensão na página de extensões.

## Uso

1. Abra uma página HTTP ou HTTPS e clique no ícone da extensão.
2. No popup, clique em **Selecionar por clique** e depois no elemento desejado; pressione Esc para cancelar. Como alternativa, cole um seletor CSS do DevTools e clique em **Usar seletor**.
3. Na pré-visualização, escolha **Retrato** ou **Paisagem** na barra superior. A paginação automática permanece habilitada.
4. **Páginas automáticas** mantém o conteúdo original. Em **Páginas manuais**, adicione elementos individualmente pelo menu contextual; cada um vira uma página dimensionada pelo elemento. Use as miniaturas laterais, os botões de ordem ou arraste para reorganizar as páginas.
5. Ative **Modo edição** para destacar elementos ao passar o mouse e abrir o menu contextual com o botão direito. No menu, adicione páginas manuais, edite ou remova elementos; desative o modo para ocultar essas ferramentas.
6. Clique em **Salvar como PDF** e escolha o destino na janela de impressão.
