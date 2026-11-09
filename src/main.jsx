import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selector, setSelector] = React.useState('');

  async function startSelection(cssSelector = '') {
    setWorking(true);
    setError('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_PICKER',
        selector: cssSelector.trim(),
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Não foi possível iniciar a seleção.');
      }
      window.close();
    } catch (selectionError) {
      setError(selectionError.message);
      setWorking(false);
    }
  }

  return (
    <main className="popup">
      <div className="brand-mark" aria-hidden="true">PDF</div>
      <p className="eyebrow">EXTENSÃO PARA CHROME</p>
      <h1>Salve qualquer elemento em PDF</h1>
      <p className="description">
        Escolha um elemento da página aberta para preparar como PDF.
      </p>
      <button className="select-button" onClick={() => startSelection()} disabled={working}>
        {working ? 'Iniciando…' : 'Selecionar por clique'}
      </button>
      <div className="selector-entry">
        <label htmlFor="css-selector">Ou cole um seletor CSS</label>
        <textarea
          id="css-selector"
          rows="3"
          placeholder="body > div.wrap > div > ..."
          value={selector}
          onChange={(event) => setSelector(event.target.value)}
          spellCheck="false"
        />
        <button
          className="selector-button"
          onClick={() => startSelection(selector)}
          disabled={working || !selector.trim()}
        >
          Usar seletor
        </button>
      </div>
      <p className="hint">No DevTools, clique com o botão direito no elemento e escolha “Copy selector”.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
