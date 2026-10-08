# Ядро документа

Читай ../../docs/project-format.md; если присутствуют, также ADR сцены и
compatibility docs. Ключевые файлы: project.ts, operations.ts, store.ts, tokens.ts.

- Сохраняй независимость модели от React/Puck/Electron. Не добавляй UI state в Project.
- Пакет применяется целиком: invalid последняя операция не оставляет первые в документе.
  История, receipts, revision и durable recovery используют один путь записи.
- Пределы включают scene definitions и материализованные instances; расширение формата
  проверяется parser и service schema, а не только TS-интерфейсом.
- Rename/delete/clone учитывают стабильные IDs, token aliases, instances, overrides,
  group membership и anchors. Locked предок/потомок не обходится командой UI.
- Scene math общая для renderer и hit test: CSS pixels, порядок слоёв, transforms,
  hidden/locked и clip. Camera zoom не переписывает координаты узлов.
- Проверки конфликтов, идемпотентности, отказов записи и миграции используют временную
  папку; не ослабляй safety checks ради прохода теста.
