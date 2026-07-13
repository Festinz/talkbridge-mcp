import { stopArgosTranslationWorker } from "../dist/providers/argosTranslationProvider.js";
import { stopNllbTranslationWorker } from "../dist/providers/nllbTranslationProvider.js";
import { TranslationService } from "../dist/translation.js";

const samples = [
  {
    label: "Spanish received",
    text: "Hola, soy un hombre guapo de 29 años.",
    sourceLanguage: "auto",
    targetLanguage: "ko",
    mode: "incoming"
  },
  {
    label: "French received",
    text: "Bonjour, pouvons-nous nous retrouver après la réunion ?",
    sourceLanguage: "auto",
    targetLanguage: "ko",
    mode: "incoming"
  },
  {
    label: "German received",
    text: "Wir treffen uns morgen vor dem Bahnhof.",
    sourceLanguage: "auto",
    targetLanguage: "ko",
    mode: "incoming"
  },
  {
    label: "Arabic received",
    text: "سأتصل بك بعد الاجتماع.",
    sourceLanguage: "auto",
    targetLanguage: "ko",
    mode: "incoming"
  },
  {
    label: "Vietnamese received",
    text: "Tôi sẽ đến sau mười phút nữa.",
    sourceLanguage: "auto",
    targetLanguage: "ko",
    mode: "incoming"
  },
  {
    label: "Chinese received",
    text: "会议结束后我给你打电话。",
    sourceLanguage: "auto",
    targetLanguage: "ko",
    mode: "incoming"
  },
  {
    label: "Japanese received",
    text: "会議が終わったら電話します。",
    sourceLanguage: "auto",
    targetLanguage: "ko",
    mode: "incoming"
  },
  {
    label: "Korean to Japanese",
    text: "회의가 끝나면 내가 전화할게.",
    sourceLanguage: "ko",
    targetLanguage: "ja",
    mode: "outgoing"
  },
  {
    label: "Korean to Spanish",
    text: "회의가 끝나면 내가 전화할게.",
    sourceLanguage: "ko",
    targetLanguage: "es",
    mode: "outgoing"
  }
];

const service = new TranslationService();
let failed = false;

try {
  for (const sample of samples) {
    const result = await service.translate(sample);
    console.log(JSON.stringify({
      label: sample.label,
      detected: result.sourceLanguage,
      target: result.targetLanguage,
      provider: result.provider,
      fallback: result.fallback,
      latencyMs: result.latencyMs,
      translatedText: result.translatedText
    }, null, 2));
    if (result.fallback || result.translatedText === result.originalText) failed = true;
  }
} finally {
  stopNllbTranslationWorker();
  stopArgosTranslationWorker();
}

if (failed) process.exitCode = 1;
