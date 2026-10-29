import { english } from "./en";
export const russian: Record<string, string> = Object.fromEntries(
  Object.keys(english).map((key) => [key, key]),
);

Object.assign(russian, {
  GUIDE_CONTEXT_UNAVAILABLE: "Страница направляющей недоступна.",
  GUIDE_LOCKED: "Сначала разблокируйте направляющую.",
  GUIDE_NOT_FOUND: "Направляющая больше не существует.",
  INVALID_GUIDE: "Проверьте ось и координату направляющей.",
  GUIDE_LIMIT: "Достигнут лимит направляющих страницы.",
  DUPLICATE_GUIDE: "Направляющая с таким ID уже существует.",
});
