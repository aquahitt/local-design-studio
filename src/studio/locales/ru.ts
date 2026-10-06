import { english } from "./en";
export const russian: Record<string, string> = Object.fromEntries(
  Object.keys(english).map((key) => [key, key]),
);
