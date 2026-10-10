# Производительность свободной сцены

Воспроизводимый benchmark alpha.3 измеряет сохранённый документ и production
`Preview.Nodes`. Это проверка ядра и renderer в отдельном interaction harness;
она не заменяет браузерную приёмку дерева слоёв, pointer drag, клавиатурного
редактирования или всех окон desktop.

## Запуск и fixtures

```bash
npm ci
npx playwright install chromium
node --expose-gc --import tsx scripts/benchmarks/run.ts --browser --output /tmp/studio-benchmark-results.json
```

Без `--browser` запускаются только ядро, durable store, SSR и MCP read helper.
`--budgets path.json` позволяет проверить другой набор ceilings; JSON с результатом
сохраняется даже при превышении. Код завершения 1 означает нарушение бюджета,
отсутствующую метрику, неожиданный отказ или ошибку browser harness.

`scripts/benchmarks/fixture.ts` создаёт ровно 1 000, 10 000 и 50 000 слоёв с
детерминированными IDs `layer-00000`…: текст, пустые фреймы и векторы. Координаты,
типы и текст не зависят от времени/случайности. Fixtures создаются в памяти,
без внешних assets или сети; пользовательские каталоги не открываются.
Для ручного воспроизведения JSON можно сохранить результат
`createBenchmarkFixture(count)` через обычный `JSON.stringify`.

Один warmup не включается в результаты; затем выполняются пять измерений.
Публикуется p95, то есть максимум пяти образцов, и все исходные samples.
Hit testing отдельно усредняет 20 world queries внутри каждого образца.
`--expose-gc` включает GC между core samples; доступность GC записывается в отчёт.
Локальные числа сравниваются на одной машине; hosted CI проверяет отдельные
абсолютные ceilings с запасом, а не равенство скорости двух машин.

## Что измеряется

- `parseMs`: JSON decoding + canonical parsing/validation.
- `canonicalMs`: детерминированная сериализация всего документа.
- `loadMs` и `saveMs`: реальный временный `ProjectStore`, durable edit, закрытие и
  открытие сохранённого проекта. После restart проверяются revision и текст.
  Каждый sample использует новый каталог; fsync входит в save.
- `transformMs`: flatten всех слоёв + перевод координат всей сцены в камеру.
- `hitTestMs`: bounding-box picking с преобразованиями, среднее на query.
- `editBatchMs`: текстовая правка одного узла через общий batch engine.
- `mcpSelectionMs`: selection read последнего ID + 20-row read + сериализация.
  Это общий read helper, без stdio/network latency. Отчёт отдельно хранит bytes
  одиночного selection response и 20-row response; tokens не включаются.
- `renderSsrMs`: React SSR production `Preview.Nodes`, включая все слои.
- `browserRenderMs`: полный unmount + mount production renderer в Chromium,
  затем два animation frames. Проверяется точное число `data-node-id` элементов;
  скрытой подмены 10k на видимую часть сцены нет.
- `browserPanZoomMs`: изменение transform камеры и ожидание paint, без document
  revision и без пересоздания всех слоёв.
- `browserDragMs`: одиночный geometry batch + React update + paint. Это задержка
  одного drop/update в harness, а не непрерывный pointer stream production UI.
- `browserTextInputMs`: настоящий input event через Playwright `fill`, batch,
  React update + paint. Это не end-to-end замер каждого физического keystroke.
- `rssMB`, `heapMB`: максимальные наблюдённые RSS/JS heap процесса во время case,
  не системное потребление всех процессов. Browser heap берётся через Chromium
  DevTools `Performance.getMetrics`; GPU/DOM/native memory не входит в JS heap.

Browser runner использует bundled React production build, production Nodes
renderer и общий `applyBatch`; все browser network requests заблокированы.
Он не запускает HTTP-сервис, не читает secrets и не пишет текущий проект.

## Локальный baseline

Полные данные и samples:
[`baseline-macos-arm64.json`](../scripts/benchmarks/baseline-macos-arm64.json).
Измерение: 2026-10-06 по Europe/Minsk, UTC timestamp сохранён в JSON.
Apple M2 Pro, 12 logical CPUs, 16 GiB RAM, Darwin 25.6.0 arm64;
Node v24.2.0, Chromium 153.0.8010.12, 1280×900, deviceScaleFactor 1.

| Метрика                          |   1k слоёв |  10k слоёв |
| -------------------------------- | ---------: | ---------: |
| Parse/validate p95               |    9.26 ms |   56.84 ms |
| Canonical serialization p95      |    2.68 ms |   19.32 ms |
| Durable reopen p95               |   39.76 ms |  251.20 ms |
| Durable save p95                 |   88.16 ms |  326.95 ms |
| Transform всего дерева p95       |    0.38 ms |    2.73 ms |
| Hit test на query                |    0.10 ms |    0.72 ms |
| Text batch p95                   |    9.41 ms |   54.92 ms |
| MCP selection helper p95         |    1.05 ms |    5.93 ms |
| Selection response               |      751 B |      758 B |
| 20-row response                  |    7 969 B |    7 972 B |
| React SSR p95                    |   53.28 ms |  233.95 ms |
| Chromium полный remount p95      |   29.20 ms |  203.80 ms |
| Chromium pan/zoom p95            |   32.60 ms |   25.90 ms |
| Chromium geometry batch/drop p95 |   33.00 ms |   94.10 ms |
| Chromium text input event p95    |   31.40 ms |   91.90 ms |
| Node RSS peak observed           | 221.58 MiB | 359.33 MiB |
| Node JS heap peak observed       |  66.06 MiB | 166.09 MiB |
| Chromium JS heap peak observed   |  22.80 MiB | 110.40 MiB |

Ожидание двух animation frames входит в browser latency, поэтому camera-only
метрика может быть больше короткой core операции. Таблица не обещает 60 FPS при
непрерывном drag; для этого нужен отдельный trace реального editor input stream.

## Численные ceilings и CI

Авторитетный набор:
[`budgets.json`](../scripts/benchmarks/budgets.json).
Основные ceilings p95:

| Метрика                            |       1k ceiling |      10k ceiling |
| ---------------------------------- | ---------------: | ---------------: |
| Parse / edit batch                 |           100 ms |           600 ms |
| Canonical serialization            |            50 ms |           250 ms |
| Durable reopen / save              |           500 ms |         1 800 ms |
| Transform всего дерева             |            16 ms |            50 ms |
| Hit test на query                  |             8 ms |            16 ms |
| MCP helper read                    |            50 ms |           200 ms |
| React SSR                          |           300 ms |         1 400 ms |
| Chromium полный remount            |           800 ms |         3 000 ms |
| Chromium pan/zoom                  |           200 ms |           600 ms |
| Chromium geometry/text input event |           400 ms |         1 500 ms |
| Node RSS / JS heap                 |    512 / 256 MiB |    768 / 512 MiB |
| Chromium JS heap                   |          128 MiB |          512 MiB |
| Selection / 20-row response        | 2 500 / 25 000 B | 2 500 / 25 000 B |

Эти ceilings — защитные границы для нового alpha.3, с запасом для Ubuntu hosted
runners, не целевые UX latency. Превышение — regression; отсутствие измерения
тоже failure. Локальный baseline проходит ceilings. Первый hosted CI результат
нужно сохранить как baseline этой runner class; сами workflow артефакты содержат
CPU, память, OS, Node, browser version, samples и failures.

[`benchmark.yml`](../.github/workflows/benchmark.yml) запускается вручную,
на relevant pull requests и pushes main. Workflow устанавливает Chromium,
выполняет core+browser проверки и загружает результат даже при failure.
Unit regressions проверяют bounded responses, deterministic fixture, реальный
50k отказ и то, что budget checker обнаруживает latency/memory/size failures.

## Большие документы и 50k

Лимиты ядра остаются 5 000 000 UTF-8 bytes, 10 000 сохранённых узлов, 100 страниц,
64 уровня. Fixture на 50k имеет 8 325 296 bytes и действительно отклоняется
`PROJECT_TOO_LARGE`; source fixture после попытки всё ещё содержит все 50k узлов.
Локальный отказ занимает 99.69 ms; RSS 331.36 MiB, JS heap 98.99 MiB.
Ceilings rejection — 2 s, RSS 1 GiB, JS heap 768 MiB.

50k не является поддерживаемым target. Benchmark требует ожидаемый отказ и не
запускает для него renderer/save. Не увеличиваем лимит только ради зелёного
benchmark: для этого нужны bounded memory, virtualized tree, viewport culling,
spatial index и interactive traces. Даже 10k текстовая правка сейчас выполняет
clone+validation всего документа, так что следующий optimization target —
incremental operations/render, а не ослабление validation.

Прогресс/отмена чтения большого файла относятся к editor client; сохранение
исходного документа при отмене/отказе проверяется отдельно в UI. Benchmark
проверяет store restart и отсутствие truncation, не заявляет наличие loader UI.
Payload budgets здесь применимы к plain scene fixtures; большие component
registries/definitions и annotations требуют собственных summary/detail
contracts, а не включения всего документа в selection response.
