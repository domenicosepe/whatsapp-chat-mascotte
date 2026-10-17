// Configurazione condivisa tra pannello admin (client) e salvataggio (server).
// Viene salvata come metafield JSON dell'app ($app:mascot / config) e letta
// dal blocco app embed del tema (extensions/mascot-embed).

export const MASCOTS = [
  { id: "donna", label: "Donna", src: "/mascotte/mascotte-donna.webp" },
  { id: "uomo", label: "Uomo", src: "/mascotte/mascotte-uomo.webp" },
  { id: "rapper", label: "Rapper", src: "/mascotte/mascotte-rapper.webp" },
];

export const DEFAULT_CONFIG = {
  enabled: true,
  mascot: "donna",
  customUrl: "",
  phrases: [
    "Ciao! Serve una mano?",
    "Scrivici, rispondiamo subito su WhatsApp",
    "Hai domande su un prodotto?",
  ],
  interval: 5,
  bubbleDelay: 2,
  chatTitle: "Scrivici su WhatsApp",
  welcome: "Ciao! Scrivi qui la tua domanda e ti rispondiamo su WhatsApp.",
  placeholder: "Scrivi un messaggio...",
  redirectText: "Ti porto su WhatsApp...",
  quickEnabled: false,
  quickItems: ["Info su un prodotto", "Stato del mio ordine", "Spedizioni e resi"],
  bubbleBg: "#ffffff",
  bubbleText: "#1f2937",
  chatColor: "#25d366",
  phone: "",
  position: "right",
  size: 100,
  offsetBottom: 16,
  offsetSide: 16,
  showMobile: true,
  showDesktop: true,
  animate: true,
};

const MASCOT_IDS = ["donna", "uomo", "rapper", "custom"];

function clean(value, max) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanList(list, maxItems, maxLen) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => clean(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function num(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function color(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value).toLowerCase() : fallback;
}

function url(value) {
  const v = String(value ?? "").trim();
  return /^https:\/\/[^\s"'<>]+$/.test(v) ? v.slice(0, 500) : "";
}

// Ripulisce e limita qualsiasi input prima di salvarlo o usarlo.
export function sanitizeConfig(input) {
  const d = DEFAULT_CONFIG;
  const src = input && typeof input === "object" ? input : {};
  const customUrl = url(src.customUrl);
  let mascot = MASCOT_IDS.includes(src.mascot) ? src.mascot : d.mascot;
  if (mascot === "custom" && !customUrl) mascot = d.mascot;

  return {
    enabled: src.enabled !== false,
    mascot,
    customUrl,
    phrases: cleanList(src.phrases, 12, 120),
    interval: num(src.interval, 2, 30, d.interval),
    bubbleDelay: num(src.bubbleDelay, 0, 30, d.bubbleDelay),
    chatTitle: clean(src.chatTitle, 60),
    welcome: clean(src.welcome, 240),
    placeholder: clean(src.placeholder, 60),
    redirectText: clean(src.redirectText, 80),
    quickEnabled: src.quickEnabled === true,
    quickItems: cleanList(src.quickItems, 6, 60),
    bubbleBg: color(src.bubbleBg, d.bubbleBg),
    bubbleText: color(src.bubbleText, d.bubbleText),
    chatColor: color(src.chatColor, d.chatColor),
    phone: String(src.phone ?? "").replace(/\D/g, "").slice(0, 16),
    position: src.position === "left" ? "left" : "right",
    size: num(src.size, 60, 150, d.size),
    offsetBottom: num(src.offsetBottom, 0, 200, d.offsetBottom),
    offsetSide: num(src.offsetSide, 0, 200, d.offsetSide),
    showMobile: src.showMobile !== false,
    showDesktop: src.showDesktop !== false,
    animate: src.animate !== false,
  };
}

// Unisce la config salvata ai valori di default (per i campi aggiunti dopo).
export function withDefaults(saved) {
  if (!saved || typeof saved !== "object") return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...saved };
}
