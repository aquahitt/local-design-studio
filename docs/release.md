# Проверяемый alpha-релиз

Исходный выпуск воспроизводится из точного commit и package-lock.json на Node.js 24.2.0. `npm ci` устанавливает зафиксированные зависимости; скачивание npm-пакетов и Chromium требуется на этапе сборки, а работа с сохранённым desktop-проектом выполняется локально. Нативные пакеты собираются отдельно для macOS arm64/x64, Windows x64 и Linux x64. Бинарная идентичность установщиков между повторными сборками не гарантируется: подпись, архивные timestamps и runner входят в окружение сборки.

```sh
npm ci
npm test
node --test scripts/release/integrity.test.mjs
npm run typecheck
npm run build:mcp
node scripts/release/clean-smoke.mjs
npx playwright install --with-deps chromium
npm run test:browser
npm run make:desktop
node scripts/release/stage.mjs
node scripts/desktop/checksums.mjs
node scripts/release/integrity.mjs out/make
```

Для macOS также выполните `node scripts/desktop/verify-mac.mjs`, `node scripts/desktop/dmg.mjs`, `node scripts/desktop/test-dmg.mjs`; затем `node scripts/desktop/test-packaged.mjs`. На Linux packaged smoke запускается через `xvfb-run -a`. Полная CI проверяет core, реальные stdio MCP и Git сценарии, ошибки файловой системы, browser UI и запуск упакованного desktop на каждой целевой ОС. Accessibility и performance имеют отдельные сценарии; performance сохраняет численный отчёт и аппаратное окружение.

`clean-smoke.mjs` копирует собранный standalone MCP helper в временную папку без checkout/node_modules. Он создаёт новый проект, применяет предложение с явно включённой операторской auto-apply политикой, проверяет JSON на диске, завершает владельца, перезапускает и экспортирует React/CSS/tokens. Используются stdio и localhost; runtime не скачивает библиотеку или браузер. Это проверка headless артефакта; полноценный desktop lifecycle дополнительно проверяется packaged Playwright smoke. Первое локальное прохождение helper: Node 24.2.0, macOS arm64, 2026-10-06. Прохождение других ОС и установка скачанного RC подтверждаются только соответствующими CI/ручными отчётами.

Каждый platform artifact содержит установщик/ZIP, standalone `studio-mcp-<platform>-<arch>.mjs`, MIT LICENSE, notices, тексты сторонних лицензий, build metadata и `SHA256SUMS-<platform>-<arch>.txt`. Metadata указывает commit, Node и SHA256 lockfile. Checksum verifier отвергает traversal, symlink, неверный digest, повторные записи и файлы без checksum; updater `.nupkg` и `RELEASES` также проверяются. Staging переносит вложенные installer-файлы в корень до вычисления digest и отклоняет совпадающие filenames: GitHub release attachments не сохраняют вложенные пути. После скачивания всех файлов релиза поместите их в одну папку и выполните `node scripts/release/integrity.mjs <папка>` из проверенного checkout. На macOS/Linux для отдельного manifest подходит `shasum -a 256 -c SHA256SUMS-…txt` из корня artifact.

Tag workflow создаёт подписанную attestation provenance для артефактов, добавляет bundle в выпуск и пересчитывает checksums. Attestation проверяется `gh attestation verify <артефакт> --repo aquahitt/local-design-studio`. Это удостоверяет происхождение сборки и не заменяет Developer ID/notarization или Authenticode. Установщики остаются unsigned alpha. Описание и формат подписанного bundle: [actions/attest](https://github.com/actions/attest/tree/v4.0.0).

GitHub actions закреплены полными SHA с Node 24 runtime: [checkout v5](https://github.com/actions/checkout/releases/tag/v5.0.1), [setup-node v5](https://github.com/actions/setup-node/releases/tag/v5.0.0), [upload-artifact v6](https://github.com/actions/upload-artifact/releases/tag/v6.0.0), [download-artifact v7](https://github.com/actions/download-artifact/releases/tag/v7.0.0). Pages использует [configure-pages v6](https://github.com/actions/configure-pages/releases/tag/v6.0.0), [upload-pages-artifact v5](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0) и [deploy-pages v5](https://github.com/actions/deploy-pages/releases/tag/v5.0.1). Self-hosted runner должен поддерживать Node 24 actions (минимум 2.327.1 для перечисленных базовых actions).

Публикация — отдельный шаг сопровождающего: выбрать версию, проверить все CI gates на том же commit, обновить release notes, создать соответствующий `desktop-v<package.version>` tag и проверить загруженные checksums/provenance. Скрипт принимает только совпадающую alpha-версию и проверяет весь downloaded artifact до вызова gh. Не считайте локально собранную ветку опубликованным RC. Политика резервных копий и отката: [compatibility.md](compatibility.md).
