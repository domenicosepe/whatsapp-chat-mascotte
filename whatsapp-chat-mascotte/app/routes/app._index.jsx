/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  MASCOTS,
  sanitizeConfig,
  withDefaults,
} from "../mascot-config";

const NAMESPACE = "$app:mascot";
const KEY = "config";
const MAX_UPLOAD = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/webp", "image/gif", "image/jpeg"];

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query MascotConfig {
        currentAppInstallation {
          id
          metafield(namespace: "$app:mascot", key: "config") {
            value
          }
        }
      }`,
  );
  const json = await response.json();
  const raw = json.data?.currentAppInstallation?.metafield?.value;
  let saved = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }

  return {
    config: withDefaults(saved),
    shop: session.shop,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

async function uploadImage(admin, file) {
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
    return { intent: "upload", ok: false, error: "Nessun file selezionato." };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      intent: "upload",
      ok: false,
      error: "Formato non supportato. Usa PNG, WebP, GIF o JPG.",
    };
  }
  if (file.size > MAX_UPLOAD) {
    return {
      intent: "upload",
      ok: false,
      error: "Il file supera i 3 MB. Usa un'immagine più leggera.",
    };
  }

  const stagedRes = await admin.graphql(
    `#graphql
      mutation StagedUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        input: [
          {
            filename: file.name || "mascotte.png",
            mimeType: file.type,
            resource: "FILE",
            httpMethod: "POST",
            fileSize: String(file.size),
          },
        ],
      },
    },
  );
  const staged = (await stagedRes.json()).data?.stagedUploadsCreate;
  const target = staged?.stagedTargets?.[0];
  if (!target || staged?.userErrors?.length) {
    return {
      intent: "upload",
      ok: false,
      error: staged?.userErrors?.[0]?.message || "Caricamento non riuscito.",
    };
  }

  const body = new FormData();
  for (const p of target.parameters) body.append(p.name, p.value);
  body.append("file", file, file.name || "mascotte.png");
  const put = await fetch(target.url, { method: "POST", body });
  if (!put.ok) {
    return {
      intent: "upload",
      ok: false,
      error: "Caricamento dell'immagine non riuscito. Riprova.",
    };
  }

  const createRes = await admin.graphql(
    `#graphql
      mutation CreateFile($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        files: [
          {
            originalSource: target.resourceUrl,
            contentType: "IMAGE",
            alt: "Mascotte",
          },
        ],
      },
    },
  );
  const created = (await createRes.json()).data?.fileCreate;
  const fileId = created?.files?.[0]?.id;
  if (!fileId || created?.userErrors?.length) {
    return {
      intent: "upload",
      ok: false,
      error: created?.userErrors?.[0]?.message || "Creazione del file non riuscita.",
    };
  }

  // Shopify elabora l'immagine in modo asincrono: aspettiamo l'URL pubblico.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const res = await admin.graphql(
      `#graphql
        query FileStatus($id: ID!) {
          node(id: $id) {
            ... on MediaImage {
              fileStatus
              image {
                url
              }
            }
          }
        }`,
      { variables: { id: fileId } },
    );
    const node = (await res.json()).data?.node;
    if (node?.image?.url) {
      return { intent: "upload", ok: true, url: node.image.url };
    }
    if (node?.fileStatus === "FAILED") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return {
    intent: "upload",
    ok: false,
    error: "Shopify sta ancora elaborando l'immagine. Riprova tra qualche secondo.",
  };
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "upload") {
    return uploadImage(admin, form.get("file"));
  }

  if (intent === "save") {
    let parsed;
    try {
      parsed = JSON.parse(String(form.get("config") || "{}"));
    } catch {
      return { intent: "save", ok: false, error: "Dati non validi." };
    }
    const config = sanitizeConfig(parsed);

    const idRes = await admin.graphql(
      `#graphql
        query AppInstallationId {
          currentAppInstallation {
            id
          }
        }`,
    );
    const ownerId = (await idRes.json()).data?.currentAppInstallation?.id;
    if (!ownerId) {
      return { intent: "save", ok: false, error: "Impossibile leggere l'app." };
    }

    const res = await admin.graphql(
      `#graphql
        mutation SaveMascotConfig($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              ownerId,
              namespace: NAMESPACE,
              key: KEY,
              type: "json",
              value: JSON.stringify(config),
            },
          ],
        },
      },
    );
    const result = (await res.json()).data?.metafieldsSet;
    if (!result || result.userErrors?.length) {
      return {
        intent: "save",
        ok: false,
        error: result?.userErrors?.[0]?.message || "Salvataggio non riuscito.",
      };
    }
    return { intent: "save", ok: true, config };
  }

  return { intent: "unknown", ok: false, error: "Richiesta non valida." };
};

function lines(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function Preview({ cfg, phrases, quick, src }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");

  useEffect(() => {
    if (phrases.length < 2) return undefined;
    const t = setInterval(
      () => setI((x) => x + 1),
      Math.max(2, Number(cfg.interval) || 5) * 1000,
    );
    return () => clearInterval(t);
  }, [phrases.length, cfg.interval]);

  const right = cfg.position !== "left";
  const phrase = phrases.length ? phrases[i % phrases.length] : "";
  const height = Math.round(130 * (Number(cfg.size) || 100) / 100);

  const send = (value) => {
    const v = String(value || "").trim();
    if (!v) return;
    setMsgs((m) => [
      ...m,
      { me: true, t: v },
      { me: false, t: cfg.redirectText || "" },
    ]);
    setText("");
  };

  const toggle = () => {
    if (open) setMsgs([]);
    setOpen(!open);
  };

  const bubble = {
    background: "#fff",
    color: "#1f2937",
    padding: "8px 12px",
    borderRadius: 14,
    fontSize: 13,
    maxWidth: 190,
    boxShadow: "0 4px 16px rgba(0,0,0,.15)",
  };

  return (
    <div
      style={{
        position: "relative",
        height: 470,
        borderRadius: 12,
        background: "#f1f2f4",
        overflow: "hidden",
        border: "1px solid #e1e3e5",
      }}
    >
      <div style={{ padding: 14, display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
        {[90, 90, 12, 12, 70, 70].map((h, k) => (
          <div
            key={k}
            style={{ height: h, background: "#fff", borderRadius: 8, border: "1px solid #e1e3e5" }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 10,
          [right ? "right" : "left"]: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: right ? "flex-end" : "flex-start",
          gap: 6,
        }}
      >
        {!open && phrase ? (
          <button
            type="button"
            style={{
              ...bubble,
              background: cfg.bubbleBg,
              color: cfg.bubbleText,
              cursor: "pointer",
              border: 0,
              textAlign: "left",
              fontFamily: "inherit",
            }}
            onClick={toggle}
          >
            {phrase}
          </button>
        ) : null}
        {open ? (
          <div
            style={{
              width: 250,
              background: "#fff",
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 8px 28px rgba(0,0,0,.25)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                background: cfg.chatColor,
                color: "#fff",
                padding: "9px 12px",
                fontSize: 14,
                fontWeight: 600,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{cfg.chatTitle}</span>
              <button
                type="button"
                aria-label="Chiudi"
                onClick={toggle}
                style={{ border: 0, background: "transparent", color: "#fff", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div
              style={{
                background: "#f4f5f7",
                padding: 10,
                height: 150,
                overflow: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {cfg.welcome ? (
                <div style={{ ...bubble, fontSize: 12, alignSelf: "flex-start" }}>{cfg.welcome}</div>
              ) : null}
              {msgs.map((m, k) => (
                <div
                  key={k}
                  style={{
                    ...bubble,
                    fontSize: 12,
                    alignSelf: m.me ? "flex-end" : "flex-start",
                    background: m.me ? cfg.chatColor : "#fff",
                    color: m.me ? "#fff" : "#1f2937",
                  }}
                >
                  {m.t}
                </div>
              ))}
            </div>
            {cfg.quickEnabled && quick.length ? (
              <div style={{ background: "#f4f5f7", padding: "0 10px 8px", display: "flex", flexWrap: "wrap", gap: 5 }}>
                {quick.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    style={{
                      border: `1px solid ${cfg.chatColor}`,
                      background: "#fff",
                      borderRadius: 999,
                      padding: "4px 9px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : null}
            <form
              style={{ display: "flex", gap: 6, padding: 8, borderTop: "1px solid #e5e7eb" }}
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={cfg.placeholder}
                style={{ flex: 1, minWidth: 0, border: "1px solid #d1d5db", borderRadius: 999, padding: "6px 10px", fontSize: 12 }}
              />
              <button
                type="submit"
                aria-label="Invia"
                style={{ border: 0, borderRadius: "50%", width: 30, height: 30, background: cfg.chatColor, color: "#fff", cursor: "pointer" }}
              >
                &gt;
              </button>
            </form>
          </div>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          aria-label="Apri la chat"
          style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", lineHeight: 0 }}
        >
          <img src={src} alt="" style={{ height, width: "auto", display: "block" }} />
        </button>
      </div>
    </div>
  );
}

export default function Index() {
  const { config, shop, apiKey } = useLoaderData();
  const shopify = useAppBridge();
  const saveFetcher = useFetcher();
  const uploadFetcher = useFetcher();
  const fileRef = useRef(null);

  const [cfg, setCfg] = useState(config);
  const [phrasesText, setPhrasesText] = useState(config.phrases.join("\n"));
  const [quickText, setQuickText] = useState(config.quickItems.join("\n"));

  const set = (key, value) => setCfg((c) => ({ ...c, [key]: value }));

  const saving = saveFetcher.state !== "idle";
  const uploading = uploadFetcher.state !== "idle";

  useEffect(() => {
    const d = saveFetcher.data;
    if (!d || d.intent !== "save") return;
    if (d.ok) shopify.toast.show("Impostazioni salvate");
    else shopify.toast.show(d.error || "Salvataggio non riuscito", { isError: true });
  }, [saveFetcher.data, shopify]);

  useEffect(() => {
    const d = uploadFetcher.data;
    if (!d || d.intent !== "upload") return;
    if (d.ok && d.url) {
      setCfg((c) => ({ ...c, customUrl: d.url, mascot: "custom" }));
      shopify.toast.show("Immagine caricata. Ricorda di salvare.");
    } else {
      shopify.toast.show(d.error || "Caricamento non riuscito", { isError: true });
    }
  }, [uploadFetcher.data, shopify]);

  const phrases = lines(phrasesText);
  const quick = lines(quickText);
  const mascotSrc =
    cfg.mascot === "custom" && cfg.customUrl
      ? cfg.customUrl
      : (MASCOTS.find((m) => m.id === cfg.mascot) || MASCOTS[0]).src;

  const save = () => {
    const payload = { ...cfg, phrases, quickItems: quick };
    saveFetcher.submit({ intent: "save", config: JSON.stringify(payload) }, { method: "POST" });
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("intent", "upload");
    fd.append("file", file);
    uploadFetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
  };

  const editorUrl = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${apiKey}/mascot`;

  return (
    <s-page heading="WhatsApp Chat Mascotte">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(saving ? { loading: true } : {})}
      >
        Salva
      </s-button>

      {!cfg.phone ? (
        <s-banner tone="warning" heading="Manca il numero WhatsApp">
          Inserisci il numero nella sezione WhatsApp: senza numero la mascotte non compare sul sito.
        </s-banner>
      ) : null}

      <s-section heading="Attivazione">
        <s-paragraph>
          Dopo aver salvato, attiva la mascotte nel tema del negozio: apri l&apos;editor del tema e accendi
          l&apos;interruttore &quot;Mascotte WhatsApp&quot; negli embed dell&apos;app.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button href={editorUrl} target="_blank">
            Apri l&apos;editor del tema
          </s-button>
          <s-checkbox
            label="Mascotte attiva"
            checked={cfg.enabled}
            onChange={(e) => set("enabled", e.currentTarget.checked)}
          />
        </s-stack>
      </s-section>

      <s-section heading="Anteprima" slot="aside">
        <Preview cfg={cfg} phrases={phrases} quick={quick} src={mascotSrc} />
      </s-section>

      <s-section heading="Mascotte">
        <s-stack direction="block" gap="base">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {MASCOTS.map((m) => {
              const active = cfg.mascot === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={m.label}
                  onClick={() => set("mascot", m.id)}
                  style={{
                    width: 84,
                    height: 108,
                    padding: 4,
                    borderRadius: 12,
                    background: "#fff",
                    cursor: "pointer",
                    border: active ? "2px solid #005bd3" : "1px solid #c9cccf",
                  }}
                >
                  <img src={m.src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </button>
              );
            })}
            {cfg.customUrl ? (
              <button
                type="button"
                aria-pressed={cfg.mascot === "custom"}
                aria-label="La tua mascotte"
                onClick={() => set("mascot", "custom")}
                style={{
                  width: 84,
                  height: 108,
                  padding: 4,
                  borderRadius: 12,
                  background: "#fff",
                  cursor: "pointer",
                  border: cfg.mascot === "custom" ? "2px solid #005bd3" : "1px solid #c9cccf",
                }}
              >
                <img src={cfg.customUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              </button>
            ) : null}
          </div>
          <s-stack direction="inline" gap="base">
            <s-button onClick={() => fileRef.current?.click()} {...(uploading ? { loading: true } : {})}>
              Carica la tua mascotte
            </s-button>
            <s-text color="subdued">PNG, WebP, GIF o JPG fino a 3 MB. Meglio con sfondo trasparente.</s-text>
          </s-stack>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/webp,image/gif,image/jpeg"
            style={{ display: "none" }}
            onChange={onFile}
          />
          <s-select
            label="Posizione"
            value={cfg.position}
            onChange={(e) => set("position", e.currentTarget.value)}
          >
            <s-option value="right">In basso a destra</s-option>
            <s-option value="left">In basso a sinistra</s-option>
          </s-select>
          <label style={{ display: "block", fontSize: 13 }}>
            Dimensione: {cfg.size}%
            <input
              type="range"
              min="60"
              max="150"
              step="5"
              value={cfg.size}
              onChange={(e) => set("size", Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>
          <s-stack direction="inline" gap="base">
            <s-number-field
              label="Distanza dal basso (px)"
              min="0"
              max="200"
              value={String(cfg.offsetBottom)}
              onInput={(e) => set("offsetBottom", Number(e.currentTarget.value) || 0)}
            />
            <s-number-field
              label="Distanza dal lato (px)"
              min="0"
              max="200"
              value={String(cfg.offsetSide)}
              onInput={(e) => set("offsetSide", Number(e.currentTarget.value) || 0)}
            />
          </s-stack>
          <s-checkbox
            label="Animazione (la mascotte fluttua)"
            checked={cfg.animate}
            onChange={(e) => set("animate", e.currentTarget.checked)}
          />
        </s-stack>
      </s-section>

      <s-section heading="Frasi sopra la mascotte">
        <s-stack direction="block" gap="base">
          <s-text-area
            label="Frasi (una per riga)"
            rows="4"
            value={phrasesText}
            details="Si alternano nel fumetto. Massimo 12 frasi."
            onInput={(e) => setPhrasesText(e.currentTarget.value)}
          />
          <s-stack direction="inline" gap="base">
            <s-number-field
              label="Cambio frase ogni (secondi)"
              min="2"
              max="30"
              value={String(cfg.interval)}
              onInput={(e) => set("interval", Number(e.currentTarget.value) || 5)}
            />
            <s-number-field
              label="Il fumetto appare dopo (secondi)"
              min="0"
              max="30"
              value={String(cfg.bubbleDelay)}
              onInput={(e) => set("bubbleDelay", Number(e.currentTarget.value) || 0)}
            />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Chat">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Titolo della chat"
            value={cfg.chatTitle}
            onInput={(e) => set("chatTitle", e.currentTarget.value)}
          />
          <s-text-area
            label="Messaggio di benvenuto"
            rows="2"
            value={cfg.welcome}
            onInput={(e) => set("welcome", e.currentTarget.value)}
          />
          <s-text-field
            label="Testo nel campo di scrittura"
            value={cfg.placeholder}
            onInput={(e) => set("placeholder", e.currentTarget.value)}
          />
          <s-text-field
            label="Messaggio quando si passa a WhatsApp"
            value={cfg.redirectText}
            onInput={(e) => set("redirectText", e.currentTarget.value)}
          />
          <s-checkbox
            label="Mostra risposte rapide"
            checked={cfg.quickEnabled}
            onChange={(e) => set("quickEnabled", e.currentTarget.checked)}
          />
          {cfg.quickEnabled ? (
            <s-text-area
              label="Risposte rapide (una per riga)"
              rows="3"
              value={quickText}
              details="Il cliente le tocca e viene portato su WhatsApp con quel testo. Massimo 6."
              onInput={(e) => setQuickText(e.currentTarget.value)}
            />
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="WhatsApp">
        <s-text-field
          label="Numero WhatsApp con prefisso"
          value={cfg.phone}
          placeholder="393331234567"
          details="Prefisso internazionale senza + e senza spazi (39 = Italia)."
          onInput={(e) => set("phone", e.currentTarget.value)}
        />
      </s-section>

      <s-section heading="Colori">
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {[
            ["bubbleBg", "Sfondo fumetto"],
            ["bubbleText", "Testo fumetto"],
            ["chatColor", "Colore chat"],
          ].map(([key, label]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="color"
                value={cfg[key]}
                onChange={(e) => set(key, e.target.value)}
                style={{ width: 40, height: 32, padding: 0, border: "1px solid #c9cccf", borderRadius: 6 }}
              />
              {label}
            </label>
          ))}
        </div>
      </s-section>

      <s-section heading="Dove mostrarla">
        <s-stack direction="inline" gap="base">
          <s-checkbox
            label="Su mobile"
            checked={cfg.showMobile}
            onChange={(e) => set("showMobile", e.currentTarget.checked)}
          />
          <s-checkbox
            label="Su desktop"
            checked={cfg.showDesktop}
            onChange={(e) => set("showDesktop", e.currentTarget.checked)}
          />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
