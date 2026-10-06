import { useI18n } from "./i18n";
import { useEffect, useState } from "react";
import type { StudioClient } from "./client";
import type { ImageAsset } from "../service/image-assets";
const MAX_BYTES = 8 * 1024 * 1024;
/** The browser decodes raster files; normalized PNG is validated again by the owner. */
async function imageInput(file: File) {
  if (file.size > MAX_BYTES) throw new Error("Изображение больше 8 МБ.");
  if (file.type === "image/svg+xml") {
    const text = await file.text();
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 4096)
      binary += String.fromCharCode(...bytes.subarray(index, index + 4096));
    return { name: file.name, mediaType: file.type, data: btoa(binary) };
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Выбери PNG, JPEG, WebP или SVG.");
  const bitmap = await createImageBitmap(file);
  try {
    if (
      bitmap.width > 8192 ||
      bitmap.height > 8192 ||
      bitmap.width * bitmap.height > 16_000_000
    )
      throw new Error("Слишком большое разрешение изображения.");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось декодировать изображение.");
    context.drawImage(bitmap, 0, 0);
    const encoded = canvas.toDataURL("image/png").split(",")[1];
    if (encoded.length > Math.ceil(MAX_BYTES / 3) * 4)
      throw new Error("После преобразования PNG превышает 8 МБ.");
    return { name: file.name, mediaType: "image/png", data: encoded };
  } finally {
    bitmap.close();
  }
}
export function Assets({
  client,
  revision,
  onInsert,
}: {
  client: StudioClient;
  revision: number;
  onInsert: (asset: ImageAsset) => Promise<void>;
}) {
  const { t } = useI18n();

  const [rows, setRows] = useState<ImageAsset[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refresh = () =>
    client.request<ImageAsset[]>("assets-list").then(setRows);
  useEffect(() => {
    if (!__STUDIO_DEMO__) void refresh().catch((e) => setError(e.message));
  }, [client, revision]);
  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (__STUDIO_DEMO__)
    return (
      <section className="panel">
        <p>
          {t(
            "Импорт изображений доступен в локальной студии. Ресурсы хранятся в папке проекта.",
          )}
        </p>
      </section>
    );
  return (
    <section className="panel asset-library">
      <h2>{t("Изображения проекта")}</h2>
      <label className="asset-import">
        {t("Добавить изображения")}
        <input
          aria-label={t("Импорт изображений")}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          multiple
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void run(async () => {
              for (const file of files)
                await client.request("assets", await imageInput(file));
            });
          }}
        />
      </label>
      <p className="muted">
        {t(
          "PNG, JPEG, WebP и безопасное подмножество SVG. Растровые изображения сохраняются как PNG; метаданные файла не переносятся.",
        )}
      </p>
      {busy && <p role="status">{t("Обрабатываем изображения…")}</p>}
      {error && <p role="alert">{t(error)}</p>}
      <div className="asset-grid">
        {rows.map((asset) => (
          <article key={asset.path} className="asset-card">
            {asset.missing ? (
              <p role="status">{t("Файл отсутствует")}</p>
            ) : (
              <img src={asset.path} alt={asset.name} loading="lazy" />
            )}
            <strong>{asset.name}</strong>
            <small>
              {asset.width ? `${asset.width} × ${asset.height} · ` : ""}
              {Math.round(asset.bytes / 1024)} {t("КБ ·")}{" "}
              {asset.used ? t("Используется") : t("Не используется")}
            </small>
            <div>
              <button
                disabled={busy || asset.missing}
                onClick={() => void run(() => onInsert(asset))}
              >
                {t("На экран +")}
              </button>
              <button
                disabled={busy || asset.used || asset.missing}
                title={
                  asset.used
                    ? t("Сначала удали ссылки на изображение из документа")
                    : t("Убрать неиспользуемый ресурс из библиотеки")
                }
                onClick={() => {
                  if (
                    confirm(
                      t(
                        "Убрать «{0}» из библиотеки? Файл сохранится для истории и отмены.",
                        { 0: asset.name },
                      ),
                    )
                  )
                    void run(() =>
                      client.request("assets-delete", { path: asset.path }),
                    );
                }}
              >
                {t("Убрать из библиотеки")}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <p>{t("Добавь изображения, чтобы использовать их на экранах.")}</p>
      )}
    </section>
  );
}
