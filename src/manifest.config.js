/**
 * Manifest da extensão, como dado.
 *
 * A versão vem do `package.json` durante o build: manter o número em dois
 * arquivos fazia os dois divergirem na primeira publicação esquecida.
 */

/**
 * @param {string} version
 * @returns {object}
 */
export function createManifest(version) {
  const icons = {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  };

  return {
    manifest_version: 3,
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'pt_BR',
    version,
    // `sidePanel` para o painel; `activeTab` + `scripting` para capturar na aba
    // em que o usuário clicou no ícone; `debugger` para gerar o PDF com
    // `Page.printToPDF`, única forma de cada página sair com o tamanho do seu
    // elemento; `downloads` para salvar o arquivo.
    permissions: ['sidePanel', 'activeTab', 'scripting', 'debugger', 'downloads', 'storage'],
    icons,
    action: {
      default_title: '__MSG_extName__',
      default_icon: icons,
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'",
    },
  };
}
