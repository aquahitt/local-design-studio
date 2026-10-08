# HTTP и MCP студии

Читай ../../docs/project-format.md и SDK docs. Render/handoff контракты ищи
в соответствующих docs, если эта функциональность присутствует в checkout.

- HTTP, stdio MCP и UI обращаются к одному файловому владельцу. Повторное подключение
  не меняет approval policy и не создаёт второго писателя.
- schema_read и batch schema соответствуют core parser/operations. Новый endpoint/tool
  включает проверку аргументов, origin/auth и тест контракта, а не только handler.
- MCP создаёт предложение, но не выдаёт себе UI approval. Не превращай feature-request
  в автоматическое включение STUDIO_AUTO_APPLY.
- Сохраняй limits, пагинацию, revision checks и диагностику недоступных renderer/metadata.
  stdout stdio процесса — только protocol; диагностика — stderr.
- Assets ограничены выбранным проектом; запрещены traversal/symlink, произвольный fetch
  и активное содержимое. Render читает snapshot, не изменяет проект и не запускает URL.
- Проверь service/MCP на временном проекте; чужие файлы и connection keys не fixtures.
