# Desktop оболочка

Читай ../docs/desktop.md и релизные инструкции. UI редактора — в src/studio,
UI выбора проекта — в src/desktop; main/preload/worker живут здесь.

- Сохраняй nodeIntegration=false, contextIsolation, sandbox и ограниченный preload.
  Проверяй sender/frame/origin для IPC; preview не получает bridge редактора.
- Папку проекта/библиотеки выбирает оператор, данные документа не запускают путь.
  Код библиотеки компилируется после доверия, metadata отделены от runtime.
- App shutdown дожидается операций и освобождает владельца. Смена проекта отзывает
  доступ к старому bundle; ошибка сборки не переписывает проект.
- macOS signature/notarization и Windows signing проверяются у готового артефакта.
  Development smoke не подтверждает packaged приложение или поддержку другой ОС.
- Используй STUDIO_USER_DATA с временной папкой в тестах. Packaged smoke запускай
  по scripts/desktop/test-packaged.mjs; публикация требует соответствующего поручения.
