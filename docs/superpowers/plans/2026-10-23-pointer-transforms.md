# #9 — ручки преобразований холста

Продолжение принятой матричной модели и числовых Resize/Scale/Rotate. Изменения
применяются одним общим batch с captured revision; pointer preview не пишет проект.

1. Core: immutable capture, Move/Resize/Scale/Rotate, single local basis и multi world
   AABB, противоположная опора, Alt=центр, Shift=пропорции/шаг угла 15°, rotation unwrap.
   Нулевой/отрицательный размер при жесте недопустим; отражение остаётся явным действием.
2. Preview: полная whitelist SceneGeometryMap вместо частичных positions. Effective
   geometry применяется до text layout, vector viewBox и CSS; IPC сохраняет проверки.
3. Canvas: default Resize, K=Scale, V=Resize/выбор; внутреннее перетаскивание — Move,
   отдельная круглая ручка — Rotate. Hand/Space/middle управляют камерой. Клавиатурная
   альтернатива — кнопка открытия числовой панели с переводом фокуса.
4. Жест фиксирует project/page/revision/selection/camera/size/locale/tool. Один RAF
   публикует последнее preview; pointerup синхронно пересчитывает последние координаты.
   Escape/blur/lostcapture/внешнее изменение отменяют жест и поздние callbacks.
5. Transient/pending/invalid bounds не выдаются агенту как canonical. После clear
   нужен новый matching epoch. Neutral gesture не создаёт revision; invalid final
   не применяет предыдущий удачный результат.

Приёмка: core exact corners/anchors/modifiers/locks/noops; preview text/vector parity;
реальный browser Resize против Scale, rotation, cancel/conflict, один batch/Undo/reopen,
RU/EN/light/dark, camera shortcuts и полная регрессия. Snapping/линейки/направляющие —
следующий этап; issue #9 остаётся открытой.
