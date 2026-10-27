const MAX_BYTES = 8 * 1024 * 1024;
/** The browser decodes raster files; normalized PNG is validated again by the owner. */
export async function imageInput(file: File) {
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
