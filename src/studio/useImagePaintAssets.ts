import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageAsset } from "../service/image-assets";
import type { StudioClient } from "./client";
import { imageInput } from "./imageInput";

/** Narrow asset capability. Uploading bytes never writes the document draft. */
export function useImagePaintAssets(
  client: Pick<StudioClient, "request"> | undefined,
  projectId: string,
  revision: number,
) {
  const [assets, setAssets] = useState<ImageAsset[]>([]),
    [error, setError] = useState("");
  const generation = useRef(0);
  const active = useRef({ client, projectId });
  active.current = { client, projectId };
  useEffect(() => {
    let live = true;
    const request = ++generation.current;
    setError("");
    if (!client || __STUDIO_DEMO__) {
      setAssets([]);
      return;
    }
    void client
      .request<ImageAsset[]>("assets-list")
      .then((rows) => {
        if (live && request === generation.current) setAssets(rows);
      })
      .catch((error) => {
        if (live) setError((error as Error).message);
      });
    return () => {
      live = false;
    };
  }, [client, projectId, revision]);
  const importImage = useCallback(
    async (file: File) => {
      if (!client || __STUDIO_DEMO__)
        throw new Error(
          "Импорт изображений доступен в локальной студии. Ресурсы хранятся в папке проекта.",
        );
      const input = await imageInput(file);
      // Do not upload into a connection that has already been replaced.
      if (
        active.current.client !== client ||
        active.current.projectId !== projectId
      )
        throw new Error("Контекст изображения изменился. Повтори импорт.");
      const asset = await client.request<ImageAsset>("assets", input);
      if (
        active.current.client === client &&
        active.current.projectId === projectId
      ) {
        const request = ++generation.current;
        setAssets((rows) => [
          asset,
          ...rows.filter((row) => row.path !== asset.path),
        ]);
        // An older list response must not erase the just-imported resource. A
        // fresh list also retains resources not loaded when the upload began.
        void client
          .request<ImageAsset[]>("assets-list")
          .then((rows) => {
            if (
              request === generation.current &&
              active.current.client === client &&
              active.current.projectId === projectId
            )
              setAssets(rows);
          })
          .catch(() => {
            /* Keep imported metadata; next revision retries the list. */
          });
      }
      return asset;
    },
    [client, projectId],
  );
  return {
    assets,
    error,
    importImage: client && !__STUDIO_DEMO__ ? importImage : undefined,
  };
}
