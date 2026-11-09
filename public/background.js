chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'START_PICKER') {
    startPicker(message.selector).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: error.message }),
    );
    return true;
  }

  if (message?.type === 'PRINT_SELECTION') {
    saveSelection(message).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: error.message }),
    );
    return true;
  }

  if (message?.type === 'GET_PRINT_DATA') {
    getPrintData(message.token).then(
      (data) => sendResponse({ ok: true, data }),
      (error) => sendResponse({ ok: false, error: error.message }),
    );
    return true;
  }

  return false;
});

async function startPicker(selector) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    throw new Error('Esta página não permite seleção. Abra um site e tente novamente.');
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch {
    throw new Error('Não foi possível acessar esta página. Algumas páginas do Chrome não permitem extensões.');
  }

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'START_SELECTION',
    selector: typeof selector === 'string' ? selector.trim() : '',
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Não foi possível selecionar o elemento.');
  }
}

async function saveSelection(message) {
  const token = crypto.randomUUID();
  const data = {
    html: message.html,
    sourceUrl: message.sourceUrl,
    title: message.title || 'Elemento selecionado',
    orientation: 'portrait',
  };

  await writeSelection(token, data);
  try {
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`print.html?token=${encodeURIComponent(token)}`),
    });
  } catch (error) {
    await deleteSelection(token);
    throw error;
  }
}

async function getPrintData(token) {
  if (!token || !/^[\da-f-]{36}$/i.test(token)) {
    throw new Error('Identificador do elemento inválido.');
  }

  const data = await readAndDeleteSelection(token);
  if (!data) {
    throw new Error('Os dados do elemento não estão mais disponíveis. Selecione-o novamente.');
  }

  return data;
}

function openSelectionDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('element-pdf-selections', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('selections');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
  });
}

async function writeSelection(token, data) {
  const database = await openSelectionDatabase();
  try {
    await runSelectionTransaction(database, (store) => store.put(data, token));
  } finally {
    database.close();
  }
}

async function readAndDeleteSelection(token) {
  const database = await openSelectionDatabase();
  try {
    const transaction = database.transaction('selections', 'readwrite');
    const store = transaction.objectStore('selections');
    const request = store.get(token);
    let data;
    request.onsuccess = () => {
      data = request.result;
      if (data) store.delete(token);
    };
    await transactionDone(transaction);
    return data;
  } finally {
    database.close();
  }
}

async function deleteSelection(token) {
  const database = await openSelectionDatabase();
  try {
    await runSelectionTransaction(database, (store) => store.delete(token));
  } finally {
    database.close();
  }
}

function runSelectionTransaction(database, operation) {
  const transaction = database.transaction('selections', 'readwrite');
  operation(transaction.objectStore('selections'));
  return transactionDone(transaction);
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao armazenar o elemento selecionado.'));
    transaction.onabort = () => reject(transaction.error || new Error('O armazenamento do elemento foi cancelado.'));
  });
}
