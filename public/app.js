const chat = document.querySelector("#chat");
const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#send");
const providerSelect = document.querySelector("#provider");
const providerHint = document.querySelector("#providerHint");
const partnerLanguageSelect = document.querySelector("#partnerLanguage");
const livePreview = document.querySelector("#livePreview");
const previewText = document.querySelector("#previewText");
const previewMeta = document.querySelector("#previewMeta");
const previewLanguage = document.querySelector("#previewLanguage");
const imageInput = document.querySelector("#imageInput");
const imageStatus = document.querySelector("#imageStatus");
const imagePreview = document.querySelector("#imagePreview");
const imagePreviewImage = document.querySelector("#imagePreviewImage");
const clearImageButton = document.querySelector("#clearImage");
const quickButtons = Array.from(document.querySelectorAll("[data-prompt]"));
const quickIncomingButton = document.querySelector("#quickIncoming");
const quickOutgoingButton = document.querySelector("#quickOutgoing");
const quickAppointmentButton = document.querySelector("#quickAppointment");
const modeButtons = Array.from(document.querySelectorAll("[data-mode].mode-button"));

let currentMode = "incoming";
let previewTimer;
let imageObjectUrl;
let detectedPartnerLanguage = "ja";
const conversationId = "demo";

const languageLabels = {
  auto: "자동 감지",
  ja: "일본어",
  en: "영어",
  zh: "중국어",
  es: "스페인어",
  fr: "프랑스어",
  de: "독일어",
  pt: "포르투갈어",
  it: "이탈리아어",
  ru: "러시아어",
  ar: "아랍어",
  hi: "힌디어",
  vi: "베트남어",
  th: "태국어",
  id: "인도네시아어",
  tr: "튀르키예어",
  uk: "우크라이나어"
};

languageLabels.ko = "한국어";

const incomingSamples = {
  ja: "明日、何時に会える？",
  en: "What time can we meet tomorrow?",
  zh: "我们明天几点见面？",
  es: "¿A qué hora podemos vernos mañana?",
  fr: "À quelle heure pouvons-nous nous voir demain ?",
  de: "Um wie viel Uhr können wir uns morgen treffen?",
  pt: "A que horas podemos nos encontrar amanhã?",
  it: "A che ora possiamo vederci domani?",
  ru: "Во сколько мы можем встретиться завтра?",
  ar: "في أي وقت يمكننا أن نلتقي غدًا؟",
  hi: "हम कल कितने बजे मिल सकते हैं?",
  vi: "Ngày mai chúng ta có thể gặp nhau lúc mấy giờ?",
  th: "พรุ่งนี้เราเจอกันกี่โมงดี?",
  id: "Besok kita bisa bertemu jam berapa?",
  tr: "Yarın saat kaçta buluşabiliriz?",
  uk: "О котрій годині ми можемо зустрітися завтра?"
};

function activePartnerLanguage() {
  return partnerLanguageSelect.value === "auto"
    ? detectedPartnerLanguage
    : partnerLanguageSelect.value;
}

async function loadSupportedLanguages() {
  try {
    const response = await fetch("/api/demo/languages");
    if (!response.ok) return;
    const payload = await response.json();
    for (const language of payload.languages ?? []) {
      languageLabels[language.code] = language.label;
      if (!Array.from(partnerLanguageSelect.options).some((option) => option.value === language.code)) {
        partnerLanguageSelect.add(new Option(language.label, language.code));
      }
    }
  } catch {
    // The core options in the HTML remain available when the catalog endpoint is offline.
  }
}

function updateQuickLanguageLabels(language) {
  const activeLanguage = language === "auto" ? detectedPartnerLanguage : language;
  const label = languageLabels[activeLanguage] || activeLanguage?.toUpperCase() || "상대 언어";
  quickIncomingButton.textContent = `${label} 받기`;
  quickOutgoingButton.textContent = `${languageLabels.ko} 보내기`;
  quickAppointmentButton.textContent = `${label}로 보내기`;
  if (incomingSamples[activeLanguage]) {
    quickIncomingButton.dataset.prompt = incomingSamples[activeLanguage];
  }
  previewLanguage.textContent = label;
}

function syncDetectedPartner(payload) {
  const detected = payload?.detectedPartnerLanguage
    || payload?.incoming?.translation?.sourceLanguage
    || (payload?.messages ? payload.partnerLanguage : undefined);
  if (detected && !["auto", "unknown"].includes(detected)) {
    detectedPartnerLanguage = detected;
    const detectedLabel = payload?.incoming?.translation?.sourceLabel
      || payload?.partnerLanguageLabel
      || languageLabels[detected]
      || detected.toUpperCase();
    languageLabels[detected] = detectedLabel;
    if (!Array.from(partnerLanguageSelect.options).some((option) => option.value === detected)) {
      partnerLanguageSelect.add(new Option(detectedLabel, detected));
    }
    const autoOption = Array.from(partnerLanguageSelect.options).find((option) => option.value === "auto");
    if (autoOption) autoOption.textContent = `자동 감지 · ${detectedLabel}`;
  }
  updateQuickLanguageLabels(partnerLanguageSelect.value);
}

const initialPayload = {
  conversationId,
  incomingMessage: "明日、何時に会える？",
  myDraft: "저녁 7시에 어때?",
  partnerLanguage: "ja",
  incoming: {
    translatedText: "내일 몇 시에 만날 수 있어?",
    sourceLanguage: "ja",
    targetLanguage: "ko",
    provider: "fixture"
  },
  outgoing: {
    corrected: "저녁 7시에 어때?",
    translatedText: "19時はどう？",
    provider: "fixture"
  }
};

document.querySelector("#initialToolResponse").textContent = JSON.stringify(initialPayload, null, 2);

function setMode(mode) {
  currentMode = mode;
  for (const button of modeButtons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  promptInput.placeholder = mode === "incoming"
    ? "상대방 메시지를 붙여넣으세요"
    : "보낼 한국어 문장을 입력하세요";
  if (mode === "incoming") {
    livePreview.hidden = true;
  } else {
    void refreshLivePreview();
  }
}

function appendMessage(className, text) {
  const article = document.createElement("article");
  article.className = className;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  article.append(paragraph);
  chat.append(article);
  chat.scrollTop = chat.scrollHeight;
}

function clearSampleConversation() {
  chat.querySelectorAll(".sample-message, .sample-tool").forEach((node) => node.remove());
}

function focusLatestResult() {
  const results = chat.querySelectorAll(".live-result");
  const latest = results[results.length - 1];
  if (!latest) return;
  const chatTop = chat.getBoundingClientRect().top;
  const resultTop = latest.getBoundingClientRect().top;
  chat.scrollTop += resultTop - chatTop - 12;
}

function appendBridgeMessage(payload, request) {
  syncDetectedPartner(payload);
  const tool = document.createElement("article");
  tool.className = "tool-card";
  tool.innerHTML = `
    <header><span>TOOL 호출</span><button class="collapse" type="button" aria-label="접기">⌃</button></header>
    <div class="tool-name"><span class="dot"></span><strong>bridge_chat_turn</strong></div>
    <div class="tool-tabs"><span>Request</span><strong>Response</strong></div>
    <pre></pre>
  `;
  tool.querySelector("pre").textContent = JSON.stringify({ request, response: payload }, null, 2);
  chat.append(tool);

  if (payload.incoming) {
    const incoming = document.createElement("article");
    incoming.className = "incoming-bubble live-result";
    incoming.innerHTML = `
      <div class="message-meta"><span>상대방 메시지 번역</span><time>${languageLabels[payload.incoming.translation.sourceLanguage] ?? "자동 감지"}</time></div>
      <div class="message-box"><strong></strong><div class="translation-line"></div><small></small></div>
    `;
    incoming.querySelector("strong").textContent = payload.incoming.translation.originalText;
    incoming.querySelector(".translation-line").textContent = payload.incoming.displayedToUser;
    incoming.querySelector("small").textContent = `${payload.incoming.translation.sourceLabel} → ${payload.incoming.translation.targetLabel} · ${payload.incoming.translation.provider}`;
    chat.append(incoming);
  }

  if (payload.outgoing) {
    const outgoing = document.createElement("article");
    outgoing.className = "outgoing-bubble live-result";
    outgoing.innerHTML = `
      <div class="message-box"><strong></strong><div class="translation-line"></div><small></small></div><time>방금</time>
    `;
    outgoing.querySelector("strong").textContent = payload.outgoing.correction.corrected;
    outgoing.querySelector(".translation-line").textContent = `→ ${payload.outgoing.displayedToPartner}`;
    const fallbackNote = payload.outgoing.translation.fallback ? " · 자유 문장 fallback" : "";
    outgoing.querySelector("small").textContent = `맞춤법 교정 → ${payload.outgoing.translation.targetLabel} 전송${fallbackNote}`;
    chat.append(outgoing);
  }
  chat.scrollTop = chat.scrollHeight;
}

function appendImageBridgeResult(payload, request) {
  syncDetectedPartner(payload);
  const tool = document.createElement("article");
  tool.className = "tool-card image-tool-card";
  tool.innerHTML = `
    <header><span>TOOL CALL</span><button class="collapse" type="button" aria-label="접기">−</button></header>
    <div class="tool-name"><span class="dot"></span><strong>translate_chat_transcript</strong></div>
    <div class="tool-tabs"><span>Request</span><strong>Response</strong></div>
    <pre></pre>
  `;
  tool.querySelector("pre").textContent = JSON.stringify({
    request: { ...request, messages: "<OCR extracted left/right bubbles>" },
    response: payload
  }, null, 2);
  chat.append(tool);

  for (const message of payload.messages ?? []) {
    const bubble = document.createElement("article");
    bubble.className = `${message.side === "outgoing" ? "outgoing" : "incoming"}-bubble live-result image-result`;
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const metaLabel = document.createElement("span");
    metaLabel.textContent = message.side === "outgoing" ? "이미지 발신 메시지" : "이미지 수신 메시지";
    const metaLanguage = document.createElement("time");
    metaLanguage.textContent = `${message.sourceLabel} → ${message.targetLabel}`;
    meta.append(metaLabel, metaLanguage);

    const box = document.createElement("div");
    box.className = "message-box";
    const original = document.createElement("strong");
    original.textContent = message.correction?.corrected ?? message.originalText;
    const translated = document.createElement("div");
    translated.className = "translation-line";
    translated.textContent = message.side === "outgoing"
      ? `→ ${message.translatedText}`
      : message.translatedText;
    const detail = document.createElement("small");
    const correctionNote = message.correction ? " · 맞춤법 교정" : "";
    detail.textContent = `${message.provider} · OCR ${Math.round(message.confidence * 100)}%${correctionNote}`;
    box.append(original, translated, detail);
    bubble.append(meta, box);
    chat.append(bubble);
  }

  const summary = document.createElement("article");
  summary.className = "assistant-message image-summary";
  summary.textContent = `이미지에서 ${payload.detectedMessages ?? 0}개의 대화를 복원했습니다. 원문은 저장하지 않습니다.`;
  chat.append(summary);
  chat.scrollTop = chat.scrollHeight;
}

function showImagePreview(file) {
  if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
  imageObjectUrl = URL.createObjectURL(file);
  imagePreviewImage.src = imageObjectUrl;
  imagePreview.hidden = false;
}

function clearImageSelection() {
  if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
  imageObjectUrl = undefined;
  imageInput.value = "";
  imagePreviewImage.removeAttribute("src");
  imagePreview.hidden = true;
  imageStatus.textContent = "이미지를 선택하면 자동 분석";
  imageStatus.classList.remove("is-loading");
}

async function runImageBridge(file) {
  if (!file || !file.type.startsWith("image/")) return;
  clearSampleConversation();
  showImagePreview(file);
  imageStatus.textContent = "OCR 및 번역 중...";
  imageStatus.classList.add("is-loading");
  imageInput.disabled = true;
  sendButton.disabled = true;
  const form = new FormData();
  form.append("image", file);
  form.append("conversationId", conversationId);
  form.append("myLanguage", "ko");
  form.append("partnerLanguage", activePartnerLanguage());
  form.append("provider", providerSelect.value);
  form.append("tone", "polite");
  appendMessage("user-message", `대화 이미지: ${file.name}`);
  try {
    const response = await fetch("/api/demo/image-bridge", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    appendImageBridgeResult(payload, {
      conversationId,
      myLanguage: "ko",
      partnerLanguage: activePartnerLanguage(),
      provider: providerSelect.value
    });
    focusLatestResult();
    imageStatus.textContent = `${payload.detectedMessages}개 메시지를 복원했습니다.`;
    imageStatus.classList.remove("is-loading");
  } catch (error) {
    imageStatus.textContent = "이미지 처리 실패";
    imageStatus.classList.remove("is-loading");
    appendMessage("assistant-message", `이미지를 처리하지 못했습니다: ${error.message || error}`);
  } finally {
    imageInput.disabled = false;
    sendButton.disabled = false;
  }
}

function answerFor(payload) {
  const lines = [];
  if (payload.incoming) {
    lines.push(`상대방 메시지를 ${payload.incoming.translation.targetLabel}로 번역했어요.\n\n${payload.incoming.displayedToUser}`);
    if (payload.incoming.translation.fallback) {
      lines.push("언어를 확정하지 못했거나 해당 로컬 모델을 준비하지 못했습니다. 원문 언어를 직접 지정해 다시 시도해 주세요.");
    }
  }
  if (payload.outgoing) {
    const correction = payload.outgoing.correction;
    lines.push(`보내기 전 ${correction.changes.length}개를 다듬었어요.\n\n${correction.corrected}\n→ ${payload.outgoing.displayedToPartner}`);
    if (payload.outgoing.translation.fallback) {
      lines.push("언어를 확정하지 못했거나 해당 로컬 모델을 준비하지 못했습니다. 상대 언어를 직접 선택해 다시 시도해 주세요.");
    }
  }
  return lines.join("\n\n");
}

function requestBody(mode, text) {
  return {
    conversationId,
    partnerLanguage: activePartnerLanguage(),
    myLanguage: "ko",
    provider: providerSelect.value,
    tone: "polite",
    ...(mode === "incoming" ? { incomingMessage: text } : { myDraft: text })
  };
}

async function runMessage() {
  const text = promptInput.value.trim();
  if (!text) return;
  clearSampleConversation();
  const request = requestBody(currentMode, text);
  appendMessage("user-message", text);
  sendButton.disabled = true;
  livePreview.hidden = true;
  try {
    const response = await fetch("/api/demo/bridge-turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    appendBridgeMessage(payload, request);
    appendMessage("assistant-message", answerFor(payload));
    focusLatestResult();
    promptInput.value = "";
  } catch (error) {
    appendMessage("assistant-message", `처리 중 오류가 났어요: ${error.message || error}`);
  } finally {
    sendButton.disabled = false;
  }
}

async function refreshLivePreview() {
  if (currentMode !== "outgoing") return;
  const text = promptInput.value.trim();
  if (!text) {
    livePreview.hidden = true;
    return;
  }
  previewLanguage.textContent = languageLabels[activePartnerLanguage()] || "상대 언어";
  previewText.textContent = "번역 중…";
  previewMeta.textContent = "맞춤법 교정과 번역을 준비하고 있어요.";
  livePreview.hidden = false;
  try {
    const response = await fetch("/api/demo/live-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody("outgoing", text))
    });
    const payload = await response.json();
    if (!response.ok || !payload.outgoing) throw new Error(payload.message || "미리보기를 만들 수 없습니다.");
    previewText.textContent = payload.outgoing.displayedToPartner;
    const corrected = payload.outgoing.correction.corrected;
    const suffix = payload.outgoing.translation.fallback ? " · 언어 또는 모델 확인 필요" : ` · ${payload.outgoing.translation.provider}`;
    previewMeta.textContent = `교정: ${corrected}${suffix}`;
  } catch {
    previewText.textContent = "미리보기를 만들 수 없어요.";
    previewMeta.textContent = "보내기 버튼으로 다시 시도해 주세요.";
  }
}

function updateProviderHint() {
  const messages = {
    rules: "빠르고 무료인 기본 규칙 엔진입니다.",
    "local-gec": "내 PC의 한국어 GEC 모델을 먼저 사용하고 실패하면 규칙 엔진으로 돌아갑니다.",
    hybrid: "로컬 GEC 모델 결과를 규칙 엔진으로 한 번 더 정리합니다. 외부 API 비용은 없습니다."
  };
  providerHint.textContent = messages[providerSelect.value];
}

for (const button of modeButtons) button.addEventListener("click", () => setMode(button.dataset.mode));
for (const button of quickButtons) {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode || "incoming");
    promptInput.value = button.dataset.prompt || "";
    promptInput.focus();
  });
}

sendButton.addEventListener("click", () => void runMessage());
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void runMessage();
  }
});
promptInput.addEventListener("input", () => {
  if (currentMode !== "outgoing") return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshLivePreview(), 350);
});
partnerLanguageSelect.addEventListener("change", () => {
  updateQuickLanguageLabels(partnerLanguageSelect.value);
  previewLanguage.textContent = languageLabels[activePartnerLanguage()] || "상대 언어";
  if (currentMode === "outgoing") void refreshLivePreview();
});
providerSelect.addEventListener("change", updateProviderHint);
imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (file) void runImageBridge(file);
});
clearImageButton.addEventListener("click", clearImageSelection);
document.querySelector("#newChat").addEventListener("click", () => {
  chat.querySelectorAll(".live-result, .tool-card, .sample-message, .assistant-message:not(.intro-message), .user-message").forEach((node) => node.remove());
  promptInput.value = "";
  clearImageSelection();
  setMode("incoming");
});

updateProviderHint();
void loadSupportedLanguages();
updateQuickLanguageLabels(partnerLanguageSelect.value);
setMode("incoming");
