# WhatsApp Chat Mascotte

App Shopify: una mascotte flottante sul negozio con frasi a rotazione. Al click si apre una chat interna; quando il cliente scrive e preme invio viene portato su WhatsApp con il messaggio già pronto.

## Come è fatta

- **Pannello admin** (`app/routes/app._index.jsx`): scelta mascotte (3 incluse + caricamento della propria), frasi, chat, numero WhatsApp, colori, posizione, anteprima live.
- **Estensione tema** (`extensions/mascot-embed`): app embed "Mascotte WhatsApp" (`blocks/mascot.liquid`, `assets/mascot.js`, `assets/mascot.css`).
- **Dati**: la configurazione è un metafield JSON dell'app (`mascot_config` / `config`), letto dal tema con `app.metafields.mascot_config.config`.
- **Immagine personalizzata**: caricata nei File di Shopify (scope `write_files`), l'URL è salvato nella configurazione.
- **Mascotte incluse**: `public/mascotte/` (WebP, per il pannello admin) e `extensions/mascot-embed/assets/` (PNG, per il negozio: le estensioni del tema accettano solo png, jpg, svg, js, css, json e wasm, non WebP).

## Sviluppo

```
cd whatsapp-chat-mascotte
npm install
npm run dev
```

Poi, nel negozio di sviluppo: Impostazioni dell'app, inserire il numero WhatsApp, salvare, e attivare l'embed "Mascotte WhatsApp" dall'editor del tema (il pannello ha il pulsante che apre l'editor).

## Pubblicazione

```
npm run deploy
```

Per la produzione serve un hosting per l'app (come per le altre app) e il database: lo schema Prisma usa SQLite, adatto solo allo sviluppo.
