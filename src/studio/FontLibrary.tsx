import { useEffect, useRef, useState } from "react";
import type { Project, ProjectNode } from "../core/project";
import type { Operation } from "../core/operations";
import {
  type ProjectFont,
  projectFontFamily,
  validateProjectFont,
} from "../core/fonts";
import type { StudioClient } from "./client";
import { createProjectFontLoader } from "./projectFonts";
import { useI18n } from "./i18n";
import "./FontLibrary.css";

const fontErrors = new Map<string, string>([
  [
    "INVALID_FONT",
    "Не удалось прочитать шрифт. Выберите другой файл TTF, OTF, WOFF или WOFF2.",
  ],
  [
    "FONT_METADATA_MISSING",
    "Не удалось прочитать шрифт. Выберите другой файл TTF, OTF, WOFF или WOFF2.",
  ],
  [
    "VARIABLE_FONT_UNSUPPORTED",
    "Пока поддерживаются статические начертания. Выберите файл отдельного начертания.",
  ],
  [
    "FONT_COLLECTION_UNSUPPORTED",
    "Коллекции шрифтов пока не поддерживаются. Выберите файл отдельного начертания.",
  ],
  ["FONT_SVG_UNSUPPORTED", "Этот шрифт использует неподдерживаемые SVG-глифы."],
  ["FONT_ASSET_TOO_LARGE", "Файл шрифта больше 8 MiB."],
  [
    "FONT_DECODED_SIZE_EXCEEDED",
    "Шрифт превышает допустимый размер после распаковки.",
  ],
  ["FONT_ASSET_COUNT_EXCEEDED", "Достигнут предел файлов шрифтов в проекте."],
  ["FONT_HASH_MISMATCH", "Файл шрифта не совпадает с сохранённой версией."],
  [
    "FONT_METADATA_MISMATCH",
    "Описание начертания не соответствует файлу шрифта.",
  ],
]);

type ImportedFont = Pick<
  ProjectFont,
  "assetHash" | "format" | "family" | "weight" | "style"
> & { bytes: number; path: string; name: string };
function references(project: Project, id: string): boolean {
  const walk = (nodes: ProjectNode[]): boolean =>
    nodes.some(
      (n) =>
        n.scene?.textStyle?.fontId === id || Object.values(n.slots).some(walk),
    );
  return (
    project.pages.some((p) => walk(p.nodes)) ||
    !!project.designComponents?.some((d) => walk(d.nodes))
  );
}
function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FONT_READ_FAILED"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}
export function FontLibrary({
  client,
  project,
  onApply,
  disabled = false,
}: {
  client: Pick<StudioClient, "request">;
  project: Project;
  disabled?: boolean;
  onApply: (
    operations: Operation[],
    description: string,
    revision?: number,
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [missing, setMissing] = useState<string[]>([]);
  const current = useRef({ projectId: project.projectId, client });
  current.current = { projectId: project.projectId, client };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fontSignature = JSON.stringify(project.fonts ?? []);
  useEffect(() => {
    setBusy(false);
    setError("");
    setStatus("");
  }, [project.projectId, client]);
  useEffect(() => {
    const loader = createProjectFontLoader(document);
    let active = true;
    const nodes: ProjectNode[] = (project.fonts ?? []).map((font) => ({
      id: "sample-" + font.id,
      type: "SceneText",
      props: { text: "Aa Бб 123" },
      slots: {},
      scene: {
        kind: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 30,
        textStyle: { fontId: font.id },
      },
    }));
    void loader
      .load(project, nodes)
      .then(({ warnings }) => {
        if (active) setMissing(warnings.map((w) => w.fontId));
      })
      .catch(() => {
        if (active) setMissing(project.fonts?.map((f) => f.id) ?? []);
      });
    return () => {
      active = false;
      loader.dispose();
    };
  }, [project.projectId, fontSignature]);
  async function importFiles(files: File[]) {
    if (busy || disabled || !files.length) return;
    const revision = project.revision,
      projectId = project.projectId,
      owner = client;
    const isCurrent = () =>
      mounted.current &&
      current.current.projectId === projectId &&
      current.current.client === owner;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (
        files.length > 128 ||
        files.some((file) => file.size > 8 * 1024 * 1024)
      )
        throw new Error(t("Не больше 128 файлов, каждый до 8 MiB."));
      const faces = [...(project.fonts ?? [])],
        operations: Operation[] = [];
      for (const file of files) {
        const data = await fileData(file);
        if (!isCurrent()) return;
        const result = await owner.request<ImportedFont>("fonts", {
          data,
          name: file.name,
        });
        if (!isCurrent()) return;
        if (
          faces.some(
            (f) =>
              f.assetHash === result.assetHash &&
              f.format === result.format &&
              f.weight === result.weight &&
              f.style === result.style,
          )
        )
          continue;
        const font: ProjectFont = {
          id: `font-${result.assetHash}-${result.weight}-${result.style}`,
          name: `${result.family.slice(0, 130)} ${result.weight} ${result.style}`,
          assetHash: result.assetHash,
          format: result.format,
          family: result.family,
          weight: result.weight,
          style: result.style,
        };
        validateProjectFont(font);
        faces.push(font);
        operations.push({ type: "addProjectFont", font });
      }
      if (operations.length)
        await onApply(operations, t("Добавить шрифты проекта"), revision);
      if (isCurrent())
        setStatus(
          t(
            operations.length
              ? "Шрифты добавлены в проект"
              : "Эти шрифты уже есть в проекте.",
          ),
        );
    } catch (e) {
      if (isCurrent()) setError((e as Error).message);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  return (
    <section className="font-library" aria-busy={busy}>
      <h2>{t("Шрифты проекта")}</h2>
      <p>
        {t(
          "Файлы шрифтов хранятся в проекте и доступны агентам и экспорту. Системные шрифты автоматически не копируются.",
        )}
      </p>
      <label className="font-import">
        {t("Импортировать шрифты")}
        <input
          type="file"
          aria-label={t("Импортировать шрифты")}
          accept=".ttf,.otf,.woff,.woff2"
          multiple
          disabled={disabled || busy || __STUDIO_DEMO__}
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            void importFiles(files);
          }}
        />
      </label>
      <small>
        {t(
          "TTF, OTF, WOFF, WOFF2 · до 8 MiB на файл. Импортируйте файлы, которые разрешено использовать и хранить в проекте.",
        )}
      </small>
      {__STUDIO_DEMO__ && (
        <p>{t("Импорт файлов доступен в локальной студии.")}</p>
      )}
      {busy && <p role="status">{t("Импорт шрифтов…")}</p>}
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert">
          {error === "REVISION_CONFLICT"
            ? t(
                "Документ изменился во время импорта. Файлы загружены, но шрифты не зарегистрированы. Повторите импорт с актуальной ревизией.",
              )
            : t(fontErrors.get(error) ?? error)}
        </p>
      )}
      {!project.fonts?.length && (
        <p>{t("В проекте пока нет файлов шрифтов.")}</p>
      )}
      <ul className="font-faces">
        {project.fonts?.map((font) => (
          <li key={font.id}>
            <div>
              <strong>{font.name}</strong>
              <p>
                {font.family} · {font.weight} {font.style} ·{" "}
                {font.format.toUpperCase()}
              </p>
            </div>
            <p
              className="font-sample"
              style={{
                fontFamily: projectFontFamily(font),
                fontWeight: font.weight,
                fontStyle: font.style,
                fontSynthesis: "none",
              }}
            >
              {t("Съешь ещё этих мягких булок. Aa 123")}
            </p>
            {missing.includes(font.id) && (
              <p role="status">
                {t(
                  "Файл шрифта недоступен. Образец может использовать подмену; данные проекта сохранены.",
                )}
              </p>
            )}
            <button
              disabled={disabled || busy || references(project, font.id)}
              title={
                references(project, font.id)
                  ? t(
                      "Шрифт используется в слоях. Сначала выберите другое начертание.",
                    )
                  : undefined
              }
              aria-label={t("Удалить шрифт {0}", { "0": font.name })}
              onClick={() => {
                setError("");
                void onApply(
                  [{ type: "removeProjectFont", fontId: font.id }],
                  t("Удалить шрифт проекта"),
                  project.revision,
                ).catch((e) => setError(e.message));
              }}
            >
              {t("Удалить шрифт")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
