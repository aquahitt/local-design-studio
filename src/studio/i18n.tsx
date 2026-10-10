import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { translate } from "./locales";
export { translate } from "./locales";
export type StudioLocale = "ru" | "en";
export const STUDIO_LOCALE_KEY = "local-design-studio:locale";
export function readStudioLocale(): StudioLocale {
  try {
    return localStorage.getItem(STUDIO_LOCALE_KEY) === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}
const LocaleContext = createContext<{
  locale: StudioLocale;
  setLocale: (locale: StudioLocale) => void;
}>({ locale: "ru", setLocale: () => {} });
export function I18nProvider({
  children,
  initialLocale,
  locale: controlledLocale,
}: {
  children: ReactNode;
  initialLocale?: StudioLocale;
  locale?: StudioLocale;
}) {
  const [storedLocale, setLocale] = useState(initialLocale ?? readStudioLocale);
  const locale = controlledLocale ?? storedLocale;
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STUDIO_LOCALE_KEY, locale);
    } catch {
      /* In-memory locale remains usable when storage is unavailable. */
    }
  }, [locale]);
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}
export function useI18n() {
  const { locale, setLocale } = useContext(LocaleContext);
  return {
    locale,
    setLocale,
    t: (source: string, values?: Record<string, string | number>) =>
      translate(locale, source, values),
  };
}
export function StudioLanguageChoice() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label>
      {t("Язык студии")}
      <select
        aria-label={t("Язык студии")}
        value={locale}
        onChange={(event) =>
          setLocale(event.target.value === "en" ? "en" : "ru")
        }
      >
        <option value="ru">Русский</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
