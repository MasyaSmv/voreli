import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { en } from "./lang/en";
import { ru } from "./lang/ru";

export const supportedLanguages = ["ru", "en"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const storageKey = "voreli.language";

void i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: detectLanguage(),
  fallbackLng: "en",
  supportedLngs: supportedLanguages,
  interpolation: { escapeValue: false },
  initAsync: false,
});

applyDocumentLanguage(i18n.resolvedLanguage);

i18n.on("languageChanged", (language) => {
  const supported = normaliseLanguage(language);
  localStorage.setItem(storageKey, supported);
  applyDocumentLanguage(supported);
});

export { i18n };

function detectLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(storageKey);

  return normaliseLanguage(stored ?? navigator.language);
}

function normaliseLanguage(language: string | undefined): SupportedLanguage {
  return language?.toLocaleLowerCase().startsWith("ru") ? "ru" : "en";
}

function applyDocumentLanguage(language: string | undefined): void {
  document.documentElement.lang = normaliseLanguage(language);
}
