# Alpha.4: независимые вертикали

## Контекст и границы

Alpha.3 интегрирована через PR #73. Первый срез alpha.4 интегрирован через PR #74; дальнейшие изменения изолированы в codex/alpha4-paints. Решения о
страницах/фреймах и режиме живого компонента не подменяются этими изменениями.
Ни #7, ни #9, ни #28 не закрываются по одному helper или исправлению загрузки.

## Отмена загрузки (#28)

- Существующий AbortController должен охватывать session fetch и project read.
- Отмена показывает существующее сообщение и Retry без ожидания ответа сервера.
- Новая попытка не принимает запоздавший результат отменённой попытки.
- Отмена не останавливает recovery/migration владельца или native launcher.
- RED unit: aborted/pending connect. RED browser: delayed session/project,
  Cancel → Retry, сохранность revision и project/assets/fixtures.
- GREEN: передача signal без изменения операций/сохранения; targeted unit/browser
  и typecheck. Hosted benchmark snapshot публикуется с hardware, SHA и run URL.

## Геометрические команды (#9, подготовка)

- Чистый core module формирует обычные setNodeMetadata operations. Модель и
  сохранение не меняются; UI/MCP используют существующий batch engine.
- Translate задаётся в мировых CSS px; обратный transform родителя переводит
  смещение в локальные координаты. Rotation/размеры/стиль сохраняются.
- Align сравнивает мировые axis-aligned bounds выбранных корней: left/center/right,
  top/center/bottom. Distribute сохраняет крайние объекты и делает одинаковые
  промежутки между bounds; минимум три независимых объекта. Если для равных
  промежутков не хватает места (negative gap), команда явно отказывается:
  нельзя незаметно переставлять объекты и менять крайние элементы. Порядок
  стабилен по позиции и document order, повтор команды сохраняет геометрию.
- Выбранный потомок выбранного предка не движется дважды. Нельзя изменять
  inherited locked/non-scene или смешивать страницы; ошибки явные, без частичного
  применения. Locked потомок также остаётся защищён обычным engine.
- RED: rotated parents, ancestor dedup, mixed-parent align/distribute, invalid
  selection, source immutability. GREEN: helpers и atomic batch/undo checks.
- UI: восемь icon buttons в панели выбранных слоёв, доступные имена RU/EN,
  единая транзакция на команду и явная baseRevision снимка. Повтор уже выполненного
  выравнивания не пишет пустую транзакцию и не добавляет шаг undo.
- Проверка engine не разрешает обход locked потомка через изменение геометрии
  родителя. Изменение имени/заливки и передача неизменной геометрии разрешены.
- Pointer gestures, resize/rotate, snapping/guides ещё требуются исходным #9.

## Приёмка

Сначала независимое review каждой вертикали, затем targeted checks; общий CI и
интеграция после alpha.3. Baseline harness не выдаётся за continuous editor trace.

## Проверенный результат первого среза — 2026-10-09

Отмена session/project загрузки сохранена отдельным commit `662a710`. Команды
геометрии прошли независимый review; исправлены отрицательный gap при изменении
порядка объектов и floating-point допуск, зависящий от поперечной координаты.
Для обоих случаев сначала воспроизведён падающий тест. Защита locked потомка
через metadata родителя также подтверждена RED → GREEN регрессией.

Фактические проверки geometry-среза: 276 unit/integration passed, 5 skipped;
typecheck/build; 30 browser passed, 8 skipped; 2 demo и 9 accessibility passed.
В browser входят четыре RU/EN × light/dark geometry-сценария с Tab/Shift+Tab/Enter,
axe, реальными DOM bounds, durable revision, atomic undo и повтором без no-op
записи. Пропущенные внешние/private library fixtures не выдаются за пройденные.
Срез интегрирован через PR #74 в main `e9bb7df`. На head `87ffadc` прошли все
семь CI jobs, включая packaged Windows/Linux/macOS arm64/macOS x64:
[Desktop matrix](https://github.com/aquahitt/local-design-studio/actions/runs/38040894129).
#7/#9/#28 остаются открытыми по исходной полной приёмке.

## Решение о шрифтах

Пользователь выбрал: файлы шрифтов проекта — основной переносимый путь;
системная коллекция подключается отдельно и явно. UI должен различать «в проекте»
и «только на этом устройстве». Подмена отсутствующего шрифта не переписывает
документ; CDN не используется. Это решение для #12, не заявление о реализации.

## Сохранность рабочего checkout

После исчезновения файлов из временной рабочей папки продолжение перенесено в
постоянный игнорируемый worktree. Незакоммиченный paint-код восстановлен из
исходных patch-вызовов, а не признан готовым по прежним логам: проверки запускаются
заново. Закоммиченные изменения #73/#74 сохранены в main и GitHub.
