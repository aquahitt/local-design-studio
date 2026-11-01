/** PNG export copy; document IDs and renderer diagnostics remain unchanged. */
export const captureEnglish: Record<string, string> = {
  "Экспорт PNG": "PNG export",
  "Подготовь снимок выбранного слоя, проверь результат и скачай PNG.":
    "Prepare a snapshot of the selected layer, review it, and download the PNG.",
  "Состав PNG": "PNG contents",
  "Границы PNG": "PNG bounds",
  "Отдельный слой": "Isolated layer",
  "Фрагмент сцены": "Scene fragment",
  "Всё оформление": "All decoration",
  Геометрия: "Layout geometry",
  "Выбранный слой и его дочерние слои на прозрачном фоне. Обрезка предков отключена; обрезка внутри выбранного слоя сохраняется.":
    "The selected layer and its descendants on a transparent background. Ancestor clipping is disabled; clipping inside the selected layer is preserved.",
  "Фрагмент сцены в границах выбранного слоя: фон и соседние слои попадут в PNG. Обрезка предков сохраняется.":
    "A scene fragment within the selected layer bounds: the PNG includes the background and neighboring layers. Ancestor clipping is preserved.",
  "Границы включают обводки, тени и видимых потомков. Это консервативная область: по краям возможны прозрачные поля.":
    "Bounds include strokes, shadows, and visible descendants. This is a conservative area: transparent margins may remain around the edges.",
  "Границы по геометрии слоя. Обводки, тени и другое оформление за её пределами могут обрезаться.":
    "Bounds follow the layer's layout geometry. Strokes, shadows, and other decoration outside them may be cropped.",
  "Сначала примени или сбрось изменения слоя.":
    "Apply or discard layer changes first.",
  "Выбери слой для экспорта PNG.": "Select a layer to export as PNG.",
  "Экспорт PNG доступен в локальной студии.":
    "PNG export is available in the local studio.",
  "Подготовить PNG": "Prepare PNG",
  "Отменить ожидание PNG": "Stop waiting for PNG",
  "Подготавливаем PNG…": "Preparing PNG…",
  "Подготовка PNG": "PNG preparation",
  "Получено {0} КБ": "Received {0} KB",
  "Ожидаем снимок локального renderer.":
    "Waiting for the local renderer snapshot.",
  "Ожидание отменено. Сервис может ещё завершать снимок.":
    "Waiting cancelled. The service may still be finishing the snapshot.",
  "Предпросмотр PNG выбранного слоя": "PNG preview of the selected layer",
  "{0} × {1} px · ревизия {2}": "{0} × {1} px · revision {2}",
  "Предупреждения снимка": "Snapshot warnings",
  "Скачать PNG": "Download PNG",
  "Документ изменился. Подготовь PNG заново.":
    "The document changed. Prepare the PNG again.",
  "Выбранный слой недоступен для снимка.":
    "The selected layer is unavailable for capture.",
  "Ответ с PNG слишком большой. Уменьши слой и повтори попытку.":
    "The PNG response is too large. Reduce the layer size and try again.",
  "PNG слишком большой. Уменьши слой или выбери геометрические границы.":
    "The PNG is too large. Reduce the layer size or choose layout bounds.",
  "Не удалось загрузить изображения слоя. Проверь ресурсы проекта.":
    "Layer images could not be loaded. Check the project assets.",
  "Сервис PNG недоступен. Проверь локальный renderer.":
    "PNG capture is unavailable. Check the local renderer.",
  "Подготовка PNG заняла слишком много времени. Повтори попытку.":
    "PNG preparation timed out. Try again.",
  "Сервис вернул некорректный PNG или неполные метаданные. Обнови локальную студию и повтори попытку.":
    "The service returned an invalid PNG or incomplete metadata. Update the local studio and try again.",
  "Не удалось определить границы оформления этого слоя. Выбери геометрические границы.":
    "Could not determine decoration bounds for this layer. Choose layout bounds.",
  "Этот слой зависит от окружения. Выбери фрагмент сцены, чтобы сохранить его вид.":
    "This layer depends on its surroundings. Choose a scene fragment to preserve its appearance.",
  "Не удалось подготовить PNG. Повтори попытку.":
    "Could not prepare the PNG. Try again.",
};
