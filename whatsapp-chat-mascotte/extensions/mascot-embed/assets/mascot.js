(function () {
  "use strict";

  var root = document.getElementById("wcm-root");
  var cfgEl = document.getElementById("wcm-config");
  if (!root || !cfgEl || root.getAttribute("data-ready")) return;

  var cfg;
  try {
    cfg = JSON.parse(cfgEl.textContent);
  } catch (e) {
    return;
  }
  if (!cfg || typeof cfg !== "object") return;

  var phone = String(cfg.phone || "").replace(/\D/g, "");
  if (!phone) return;

  var isMobile = window.matchMedia("(max-width: 749px)").matches;
  if (isMobile && cfg.showMobile === false) return;
  if (!isMobile && cfg.showDesktop === false) return;

  root.setAttribute("data-ready", "1");

  var phrases = Array.isArray(cfg.phrases)
    ? cfg.phrases.filter(function (p) {
        return typeof p === "string" && p.trim();
      })
    : [];
  var quick = cfg.quickEnabled && Array.isArray(cfg.quickItems) ? cfg.quickItems.filter(Boolean) : [];
  var interval = Math.max(2, Number(cfg.interval) || 5) * 1000;
  var delay = Math.max(0, Number(cfg.bubbleDelay) || 0) * 1000;

  var mascotSrc =
    cfg.mascot === "custom" && cfg.customUrl
      ? cfg.customUrl
      : root.getAttribute("data-" + cfg.mascot) || root.getAttribute("data-donna");

  var scale = Math.min(150, Math.max(60, Number(cfg.size) || 100)) / 100;
  var height = Math.round((isMobile ? 120 : 170) * scale);

  // Le immagini caricate dal cliente possono essere enormi (es. 2048x2732):
  // la CDN di Shopify le ridimensiona se chiediamo l'altezza che serve davvero.
  var isCustom = cfg.mascot === "custom" && !!cfg.customUrl;
  function sized(src, px) {
    if (!isCustom) return src;
    try {
      var u = new URL(src, window.location.href);
      if (/(^|\.)cdn\.shopify\.com$/.test(u.hostname)) {
        u.searchParams.set("height", String(px));
        return u.toString();
      }
    } catch (e) {
      /* ignore */
    }
    return src;
  }

  root.className = "wcm-" + (cfg.position === "left" ? "left" : "right") + (cfg.animate === false ? "" : " wcm-float");
  root.style.setProperty("--wcm-h", height + "px");
  root.style.setProperty("--wcm-bottom", (Number(cfg.offsetBottom) || 16) + "px");
  root.style.setProperty("--wcm-side", (Number(cfg.offsetSide) || 16) + "px");
  if (cfg.bubbleBg) root.style.setProperty("--wcm-bubble-bg", cfg.bubbleBg);
  if (cfg.bubbleText) root.style.setProperty("--wcm-bubble-text", cfg.bubbleText);
  if (cfg.chatColor) root.style.setProperty("--wcm-chat", cfg.chatColor);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var bubble = el("div", "wcm-bubble");
  bubble.hidden = true;

  var chat = el("div", "wcm-chat");
  chat.setAttribute("role", "dialog");
  chat.setAttribute("aria-label", cfg.chatTitle || "Chat");

  var head = el("div", "wcm-head");
  var avatar = el("div", "wcm-avatar");
  var avatarImg = el("img");
  avatarImg.src = sized(mascotSrc, 160);
  avatarImg.alt = "";
  avatar.appendChild(avatarImg);
  var title = el("div", "wcm-title", cfg.chatTitle || "");
  var closeBtn = el("button", "wcm-x", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Chiudi");
  head.appendChild(avatar);
  head.appendChild(title);
  head.appendChild(closeBtn);

  var body = el("div", "wcm-body");
  body.setAttribute("aria-live", "polite");

  var chips = el("div", "wcm-chips");
  quick.forEach(function (q) {
    var c = el("button", "wcm-chip", q);
    c.type = "button";
    c.addEventListener("click", function () {
      send(q);
    });
    chips.appendChild(c);
  });

  var form = el("form", "wcm-form");
  var input = el("input", "wcm-input");
  input.type = "text";
  input.maxLength = 500;
  input.autocomplete = "off";
  input.placeholder = cfg.placeholder || "";
  input.setAttribute("aria-label", cfg.placeholder || "Messaggio");
  var sendBtn = el("button", "wcm-send");
  sendBtn.type = "submit";
  sendBtn.setAttribute("aria-label", "Invia");
  sendBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';
  form.appendChild(input);
  form.appendChild(sendBtn);

  chat.appendChild(head);
  chat.appendChild(body);
  if (quick.length) chat.appendChild(chips);
  chat.appendChild(form);

  var btn = el("button", "wcm-btn");
  btn.type = "button";
  btn.setAttribute("aria-label", cfg.chatTitle || "Apri la chat");
  btn.setAttribute("aria-expanded", "false");
  var img = el("img");
  img.src = sized(mascotSrc, height * 2);
  img.alt = "";
  img.decoding = "async";
  btn.appendChild(img);

  root.appendChild(bubble);
  root.appendChild(chat);
  root.appendChild(btn);

  var idx = 0;
  var showTimer = null;
  var rotateTimer = null;
  var isOpen = false;

  function addMsg(text, mine) {
    var m = el("div", "wcm-msg" + (mine ? " wcm-me" : ""), text);
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
  }

  function stopBubble() {
    clearTimeout(showTimer);
    clearInterval(rotateTimer);
    bubble.classList.remove("wcm-show");
    bubble.hidden = true;
  }

  function setPhrase(text) {
    bubble.textContent = text;
  }

  function startBubble() {
    stopBubble();
    if (!phrases.length || isOpen) return;
    showTimer = setTimeout(function () {
      if (isOpen) return;
      setPhrase(phrases[idx % phrases.length]);
      bubble.hidden = false;
      requestAnimationFrame(function () {
        bubble.classList.add("wcm-show");
      });
      if (phrases.length > 1) {
        rotateTimer = setInterval(function () {
          bubble.classList.add("wcm-swap");
          setTimeout(function () {
            idx = (idx + 1) % phrases.length;
            setPhrase(phrases[idx]);
            bubble.classList.remove("wcm-swap");
          }, 260);
        }, interval);
      }
    }, delay);
  }

  function openChat() {
    isOpen = true;
    stopBubble();
    chat.classList.add("wcm-open");
    btn.setAttribute("aria-expanded", "true");
    if (!body.childNodes.length && cfg.welcome) addMsg(cfg.welcome, false);
    setTimeout(function () {
      input.focus({ preventScroll: true });
    }, 50);
  }

  function closeChat() {
    isOpen = false;
    chat.classList.remove("wcm-open");
    btn.setAttribute("aria-expanded", "false");
    startBubble();
  }

  function send(text) {
    text = String(text || "").trim();
    if (!text) return;
    addMsg(text, true);
    input.value = "";
    addMsg(cfg.redirectText || "Ti porto su WhatsApp...", false);
    var url = "https://wa.me/" + phone + "?text=" + encodeURIComponent(text);
    var w = window.open(url, "_blank");
    if (w) {
      try {
        w.opener = null;
      } catch (e) {
        /* ignore */
      }
    } else {
      window.location.href = url;
    }
  }

  btn.addEventListener("click", function () {
    if (isOpen) closeChat();
    else openChat();
  });
  bubble.addEventListener("click", openChat);
  closeBtn.addEventListener("click", closeChat);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    send(input.value);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) closeChat();
  });

  startBubble();
})();
