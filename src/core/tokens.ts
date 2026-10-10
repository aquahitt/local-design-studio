export type JSONValue =
  null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export type JSONRecord = { [key: string]: JSONValue };
export type TokenType =
  "color" | "number" | "dimension" | "string" | "fontFamily";
export type Token = {
  type: TokenType;
  value: JSONValue;
  themes?: Record<string, JSONValue>;
};
export type Tokens = Record<string, Token>;
export class CoreError extends Error {
  constructor(
    public code: string,
    detail = "",
    public path?: string,
  ) {
    super(`${code}${detail ? ": " + detail : ""}`);
  }
}
const namedColors = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgrey darkgreen darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray grey green greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgrey lightgreen lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor".split(
    " ",
  ),
);
export function resolveTokens(
  tokens: Tokens,
  theme?: string,
): Record<string, JSONValue> {
  const output: Record<string, JSONValue> = {};
  const active = new Set<string>();
  function resolve(key: string): JSONValue {
    if (Object.hasOwn(output, key)) return output[key];
    if (active.has(key))
      throw new CoreError("TOKEN_CYCLE", [...active, key].join(" -> "));
    const token = tokens[key];
    if (!token) throw new CoreError("MISSING_TOKEN", key);
    if (
      !/^(?:--)?[a-zA-Z][\w.-]*$/.test(key) ||
      !["color", "number", "dimension", "string", "fontFamily"].includes(
        token.type,
      )
    )
      throw new CoreError("INVALID_TOKEN", key);
    if (
      !token ||
      typeof token !== "object" ||
      Array.isArray(token) ||
      Object.keys(token).some(
        (k) => !["type", "value", "themes"].includes(k),
      ) ||
      !Object.hasOwn(token, "value") ||
      (token.themes &&
        (!token.themes ||
          typeof token.themes !== "object" ||
          Array.isArray(token.themes)))
    )
      throw new CoreError("INVALID_TOKEN", key);
    active.add(key);
    let value =
      token.themes && theme !== undefined && Object.hasOwn(token.themes, theme)
        ? token.themes[theme]
        : token.value;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "$token" in value
    ) {
      const alias = value.$token;
      if (typeof alias !== "string" || Object.keys(value).length !== 1)
        throw new CoreError("INVALID_TOKEN_REFERENCE");
      if (tokens[alias]?.type !== token.type)
        throw new CoreError("TOKEN_TYPE_MISMATCH", key);
      value = resolve(alias);
    }
    const valid =
      token.type === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : token.type === "dimension"
          ? (typeof value === "number" && Number.isFinite(value)) ||
            (typeof value === "string" &&
              /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)$/.test(value))
          : token.type === "color"
            ? typeof value === "string" &&
              (namedColors.has(value.toLowerCase()) ||
                /^(#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|(?:rgb|hsl)a?\([\d\s.,%/-]+\))$/i.test(
                  value,
                ))
            : typeof value === "string";
    if (!valid) throw new CoreError("INVALID_TOKEN_VALUE", key);
    active.delete(key);
    output[key] = value;
    return value;
  }
  for (const key of Object.keys(tokens).sort()) resolve(key);
  return output;
}
export function exportTokensJSON(tokens: Tokens, theme: string): string {
  return JSON.stringify(resolveTokens(tokens, theme), null, 2) + "\n";
}
/** CSS quoted strings use hexadecimal escapes for controls, not JSON's \n/\t escapes. */
export function serializeCSSValue(
  value: string,
  type?: TokenType,
  key = "",
): string {
  if (type === "string")
    return (
      '"' +
      value.replace(/["\\\x00-\x1f\x7f<>]/g, (character) =>
        character === '"' || character === "\\"
          ? "\\" + character
          : "\\" + character.codePointAt(0)!.toString(16) + " ",
      ) +
      '"'
    );
  // Unquoted CSS values must not terminate a declaration or consume its suffix.
  if (/[;{}<>\x00-\x1f\x7f]/.test(value) || /\/\*|\*\//.test(value))
    throw new CoreError("UNSAFE_TOKEN_CSS", key);
  return value;
}
export function exportTokensCSS(tokens: Tokens, theme: string): string {
  const values = resolveTokens(tokens, theme);
  const names = new Set<string>();
  return (
    ":root {\n" +
    Object.keys(values)
      .sort()
      .map((key) => {
        const name = key.replace(/^--/, "").replace(/[._]/g, "-");
        if (names.has(name)) throw new CoreError("TOKEN_CSS_COLLISION", name);
        names.add(name);
        const value = serializeCSSValue(
          String(values[key]),
          tokens[key].type,
          key,
        );
        return `  --${name}: ${value};`;
      })
      .join("\n") +
    "\n}\n"
  );
}
