import { english } from "./en";
import { russian } from "./ru";
type StudioLocale = "ru" | "en";
export function translate(
  locale: StudioLocale,
  source: string,
  values: Record<string, string | number> = {},
): string {
  const dictionary = locale === "en" ? english : russian;
  const trimmed = source.trim();
  const translated =
    dictionary[source] ??
    (dictionary[trimmed]
      ? source.slice(0, source.indexOf(trimmed)) +
        dictionary[trimmed] +
        source.slice(source.indexOf(trimmed) + trimmed.length)
      : source);
  return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
