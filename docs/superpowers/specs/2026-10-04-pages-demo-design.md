# GitHub Pages demo

Цель: посетитель публичного репозитория открывает рабочее интерактивное превью студии без установки. Используем существующий UI с публичной примерной библиотекой, двумя синтетическими экранами, темами, токенами, инспектором, undo/redo и явно обозначенным примером предложения агента.

Архитектура: отдельный build mode demo принудительно исключает внешние библиотеки и файловый сервис, независимо от локальных env. BrowserDemoClient использует общий чистый движок операций, валидирует props и сохраняет изолированное состояние в localStorage. Полоса Демо сообщает браузерное хранение, отсутствие подключения AI/MCP и предлагает сброс/ссылку на репозиторий. Локальная студия сохраняет своё поведение.

GitHub Pages URL /local-design-studio/; iframe использует index.html?preview=1 вместо несуществующих статических маршрутов. Все URL ресурсов учитывают base. Демо не обращается к loopback/API и не содержит проектных данных, исходников или путей stroi.homes.

Публикация: reproducible npm run build:demo, GitHub Actions artifact/deploy с Pages permissions. Поскольку foundation PR53 ещё не merged, demo публикуется из явно выбранной ветки codex/github-pages-demo; main затем также обновляет сайт автоматически. PR отдельный и зависит от foundation. Билд сопровождается licenses/notices.

Проверка: browser storage/restart, transaction validation, approval/undo, no HTTP API, theme/iframe rendering на repo subpath, reset, private-root exclusion, deployed URL. Workflow и README получают ссылку на демо.
