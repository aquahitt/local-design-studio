# Явные группы масок — следующий участок #10

Основа — принятое пользователем решение о явной группе с выбранным источником;
архивный alpha4-paint-design.md и аудит текущего кода после PR86.

## Результат и приёмка

Группа хранит обычные редактируемые слои в исходном порядке. Один слой явно выбран
источником; остальные маскируются независимо от его позиции в списке. Режимы alpha
и luminance используют одинаковую геометрию/opacity/resources. Смена источника не
переставляет слои; снятие маски возвращает их текущий порядок и мировые координаты.
Соседние объекты вне группы не влияют на область маскирования.

Предпочтительная модель: type SceneMask, scene.kind mask, scene.maskMode alpha|luminance,
один ordered slots.children и ровно один прямой ребёнок с ProjectNode.maskSource:true.
Роль относится к членству в группе, а не к scene paint. Никаких sourceIndex или
хрупких ID refs в документе; clone/definitions/instances сохраняют markers.

## Последовательность

1. Canonical parser/scene/service schema/ADR: закрытые поля, literal true, допустимый
   контекст роли, ровно один источник, никакого собственного paint у wrapper.
   Legacy проекты не переписываются. Unknown library source сохраняется в документе,
   но не считается поддержанным renderer без доказательств.
2. setMaskSource — общая типизированная atomic operation с проверкой членства/locks.
   Wrap helpers и dedicated unwrapMask {nodeId} сохраняют IDs, порядок и world matrices; операции в одном batch.
   Insert/move/geometry и финальная parse не допускают полузаписанной группы.
   Разорванное выделение нельзя молча перегруппировать с изменением внешнего z-order.
3. Copy/paste/duplicate normalizes только root marker у отдельно копируемого source;
   вложенные источники масок сохраняются. Удаление/перенос source требует явной замены
   или снятия маски; parser никогда не выбирает нового source по индексу.
4. Общий descriptor/serializer строит конечный self-contained SVG источник и применяет
   CSS mask к обычному HTML content. Для primitives повторно используются общие
   paint/transform правила. Техническое изображение не дублирует interactive node IDs.
   Missing asset/unsupported source — diagnostic + transparent mask; PNG/handoff
   возвращают typed failure, не успешный неверный экспорт и не mask-image:none.
5. Preview/handoff/service/native используют одинаковый descriptor. Source остаётся
   одним редактируемым объектом с геометрией; source editing — временное UI state,
   не hidden в документе. Picking не объявляется pixel-accurate по bbox API.
6. Инспектор и команды: явное создание/выбор source/mode/unwrap, понятные причины отказа,
   raw drafts/conflicts/Undo, RU/EN/light/dark/keyboard и proposal preview.
7. Actual pixels alpha/luminance, transform/reflection, image/font readiness, nested
   masks/clips, PNG visual/layout и scene/isolated, самостоятельный React export,
   canonical source сохранён, durable reopen, full gates и cross-platform CI.

## Проверенная осуществимость и ограничения

Chromium153: /tmp/lds-mask-proof, 22/22 assertions. CSS data-SVG маска сохраняет обычный
HTML content DOM; подтверждены alpha/luminance, paths с transform, rounded rect,
градиенты и embedded PNG. SVG userSpaceOnUse с конечными bounds работает.
foreignObject рисует inline CSS, embedded images/fonts, но не наследует шрифты
страницы и не загружает внешние ресурсы как обычный HTML.

Критично: missing nested image может нарисовать broken-image placeholder и открыть
неправильную область. Все требуемые assets предварительно resolve/decode/embed;
пустая/ошибочная маска скрывает содержимое. Внешние URLs не проходят в SVG.
Универсальный снимок произвольного React/HTML этим proof не подтверждён.

Источники: https://www.w3.org/TR/css-masking-1/#the-mask-image
и https://www.w3.org/TR/SVG2/conform.html#secure-static-mode.

## Текущий реализованный участок

Canonical/operations/clipboard, source descriptor и SVG serializer, Preview,
standalone handoff, scoped readiness и service/native capture подключены. UI умеет
создавать/менять/снимать/разгруппировывать маску, редактировать источник и сохранять
конфликтующие черновики. Источник защищён от удаления; учитываются вложенные locks.

Независимое ревью выявило три регрессии; тесты сначала воспроизвели каждую:
прямоугольный фон vector wrapper, потеря hidden при unwrap, ложная диагностика
opacity-zero источника в handoff. Исправления прошли targeted unit и actual-pixel
проверки. RU/EN × light/dark контролы прошли axe и keyboard scenarios.

Этот участок не закрывает #10: текстовые/растровые/вложенные источники масок,
полная нормализация импорта и advanced paint остальных primitives ещё не готовы.
Фактическая поддержка и пределы описаны в [masks.md](../../masks.md).
Полные release gates выполняются перед commit/PR; публичного релиза нет.
