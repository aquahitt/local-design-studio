# ADR 0002: полные affine-преобразования и layout geometry

Дата: 2026-10-21. Статус: принят контракт; инструменты #9 реализуются поэтапно.

## Модель

`scene.linearTransform?: [a,b,c,d]` и `scene.x/y` задают полную матрицу
`[a,b,c,d,x,y]`. Локальная точка переходит в родительскую систему:
`x′=a·x+c·y+xOffset`, `y′=b·x+d·y+yOffset`. Это включает shear, nonuniform
scale и reflection. `width/height` остаются положительными локальными размерами
layout box; мировой AABB вычисляется из четырёх преобразованных углов.

`rotation` и `linearTransform` взаимоисключающие. Без матрицы действует прежний
Translate·Rotate. Чтение не добавляет поля и не переписывает legacy-файлы.
Optional расширение schemaVersion 2 соответствует ADR 0001; старый strict reader
может отвергнуть новый документ. Не преобразовывать matrix в один угол с потерей shear.

Локальные коэффициенты ограничены ±1e6; singular values — 1e-6…1e6,
condition number ≤1e8. Отрицательный determinant разрешён, нулевой — нет.
Для деревьев с affine проверяются представимость составной world matrix,
обратной матрицы и всех четырёх углов; definitions и instances проверяются также.
Раскрытие ограничено 10 000 узлами и глубиной 64 на дерево.
Эти новые проверки не включаются для документов, содержащих только legacy rotation.
Фактические пределы публикуются в capabilities.geometry.limits и задаются AFFINE_LIMITS.

## Запись

`setNodeGeometry {nodeId,geometry:{x,y,width,height,rotation?,linearTransform?}}`
заменяет только геометрические поля, удаляет альтернативное преобразование,
сохраняет kind, paint, text, path, содержимое и ID. Неполная geometry не допускается.
`setNodeMetadata` сохраняет прежнюю patch-семантику и ту же финальную валидацию;
для переключения формы преобразования используется setNodeGeometry.
Locks, revision, receipts, atomic rollback, Undo и reopen общие для обеих операций.
Предложение агента симулируется на копии, approval по-прежнему принадлежит UI.

## Resize и Scale

Scale изменяет матрицу wrapper: `Mnew=P⁻¹·A·W`, где P — world matrix родителя,
W — прежняя world matrix, A — мировое преобразование вокруг общего pivot.
Layout sizes, шрифтовые метрики, SVG path и локальная геометрия детей сохраняются;
они масштабируются визуально. Definitions не переписываются и instances не detach.

Single Resize изменяет layout width/height, сохраняет линейную часть и компенсирует
перенос по неподвижному anchor. Multi Resize точно следует общему target quad;
положительные отношения длин столбцов поглощаются width/height, остаточный shear
сохраняется. Текст получает новый wrapping box с прежними fontSize/lineHeight.
Формулы и проверочная матрица — в [плане](../superpowers/plans/2026-10-21-affine-geometry.md).

Общие чистые helpers — scaleSceneLayers, rotateSceneLayers, resizeSceneLayer,
resizeSceneLayers. Parent+child selection преобразует независимый корень один раз.
Отрицательный Scale — явный flip; Multi Resize требует положительных факторов.

## Текущий этап

Ядро, shared renderer, schema/capabilities и agent proposal поддерживают контракт.
CSS matrix общий для Preview, service capture и React handoff. Инспектор показывает
матрицу явно и сохраняет её при изменении layout размеров; прежний angle control
не выдаёт матричный слой за rotation-only. Точная матрица доступна в JSON-черновике.

Pointer handles, отдельный пользовательский Scale tool, snapping, rulers/guides
и полный transform inspector — следующие этапы #9. До их приёмки issue открыта.
Portals внешней библиотеки вне scene wrapper не наследуют его transform и clip;
точный Scale такой поверхности не обещается.
