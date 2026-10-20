# Локальные тестовые шрифты

Реальные статические OpenType шрифты для проверки импорта, FontFace и экспорта.
Не используются системные шрифты, CDN или проприетарные файлы.

- `studio-fixture.ttf`, `.woff`, `.woff2`: **Studio Fixture Mono Regular**, производная
  от [PT Mono / ParaType](https://github.com/google/fonts/tree/main/ofl/ptmono).
  Официальный исходник: `https://raw.githubusercontent.com/google/fonts/main/ofl/ptmono/PTM55FT.ttf`;
  SHA-256 `cbe732b3b8fd211fd986ebdfc9b870ddeca4faab0bb5425fc509b37f9b4ac804`.
  Copyright ParaType Ltd., 2011; лицензия [SIL OFL 1.1](OFL-PTMono.txt).
- `studio-fixture.otf`: **Studio Fixture Sans Regular**, производная от
  [Adobe Source Sans 3](https://github.com/adobe-fonts/source-sans/tree/release/OTF).
  Официальный исходник: `https://raw.githubusercontent.com/adobe-fonts/source-sans/release/OTF/SourceSans3-Regular.otf`;
  SHA-256 `08df266400933d3178d081a45f94a08814c3e55b4b7dd2e0ff69cb1329f13ab6`.
  Copyright Adobe; лицензия [SIL OFL 1.1](OFL-SourceSans3.txt).

Исходники получены 2026-10-19. Варианты переименованы, включая PostScript/CFF и
совместимые имена, чтобы не использовать Reserved Font Names для модификаций.
Copyright и лицензии сохранены. Weight=400, style=normal. Набор символов:
U+0020–007E, U+0410–044F, U+0401, U+0451 (латиница, русская кириллица, Ё/ё).

Воспроизведение: положить исходники с **проверенными SHA-256** в
`/tmp/studio-ptmono.ttf` и `/tmp/studio-sourcesans.otf`, установить FontTools 4.63.0
с поддержкой Brotli и выполнить из корня `python3 tests/fixtures/fonts/subset.py`.
Python-инструменты нужны только для регенерации, продукт и тесты читают готовые байты.

Backend проверяет контейнер, таблицы метаданных, checksums (SFNT/WOFF), границы,
лимиты декомпрессии и SHA-256. Он не исполняет TrueType bytecode и не интерпретирует
контуры glyph. Перед использованием в браузере остаётся обязательным успешный
`FontFace.load()` (Chromium OpenType Sanitizer); повреждение контуров может быть
обнаружено именно на этой стадии. WOFF2 transformed glyf/loca/hmtx ограничены по
размеру и пропускаются без интерпретации; name/OS2/head читаются без преобразований.
Коллекции, variable faces и SVG-in-font пока отклоняются с явными кодами.

Первичные спецификации реализации: [WOFF2 container/transforms/UIntBase128](https://www.w3.org/TR/WOFF2/),
[WOFF1 container](https://www.w3.org/TR/WOFF/),
[OpenType name](https://learn.microsoft.com/en-us/typography/opentype/spec/name),
[OS/2 weight/fsSelection](https://learn.microsoft.com/en-us/typography/opentype/spec/os2),
[head/checksum](https://learn.microsoft.com/en-us/typography/opentype/spec/head).
Native decompress использует [Node zlib maxOutputLength](https://nodejs.org/api/zlib.html#class-options).
