import { useTranslation } from "react-i18next";

import { supportedLanguages, type SupportedLanguage } from "../i18n/i18n";

export function LanguageSwitcher({ compact = false }: { readonly compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const activeLanguage: SupportedLanguage = i18n.resolvedLanguage?.startsWith("ru") ? "ru" : "en";

  return (
    <div
      className="flex items-center rounded-xl border border-line bg-panel/75 p-1"
      role="group"
      aria-label={t("common.language")}
    >
      {supportedLanguages.map((language) => (
        <button
          key={language}
          type="button"
          onClick={() => void i18n.changeLanguage(language)}
          aria-pressed={activeLanguage === language}
          aria-label={t(language === "ru" ? "common.russian" : "common.english")}
          title={t(language === "ru" ? "common.russian" : "common.english")}
          className={
            "rounded-lg font-bold uppercase transition " +
            (compact ? "px-1.5 py-1 text-[9px] " : "px-2.5 py-1.5 text-[10px] ") +
            (activeLanguage === language
              ? "bg-panel-hover text-ink"
              : "text-faint hover:text-ink-soft")
          }
        >
          {language}
        </button>
      ))}
    </div>
  );
}
