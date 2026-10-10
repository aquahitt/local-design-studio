import { useState } from "react";
import { zipSync, strToU8 } from "fflate";
import type { Project, ProjectPage } from "../core/project";
import type { StudioClient } from "./client";
import { useI18n } from "./i18n";

type HandoffBundle = { revision: number; supported: boolean; files: Record<string, string>; assets: { path: string; data: string }[]; requirements: unknown; diagnostics: { code: string; message: string }[] };
export function Handoff({ project, page, nodeId, client }: { project: Project; page: ProjectPage; nodeId: string | null; client: StudioClient }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [inspection, setInspection] = useState<{ revision: number; [key: string]: unknown } | null>(null);
  const [bundle, setBundle] = useState<HandoffBundle | null>(null);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function download() {
    if (!bundle) return;
    const entries: Record<string, Uint8Array> = {};
    for (const [path, source] of Object.entries(bundle.files)) entries[path] = strToU8(source);
    for (const asset of bundle.assets) entries["public/" + asset.path] = Uint8Array.from(atob(asset.data), (char) => char.charCodeAt(0));
    const bytes = zipSync(entries);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const link = document.createElement("a"); link.href = url; link.download = `studio-screen-${bundle.revision}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="panel handoff">
    <summary>{t("Inspect и экспорт React")}</summary>
    <p>{t("Экспорт содержит экран, runtime, токены и локальные изображения. React-библиотеку проекта нужно подключить отдельно.")}</p>
    <button disabled={busy || !nodeId || __STUDIO_DEMO__} onClick={() => void run(async () => {
      setInspection(await client.request("inspect", { pageId: page.screenId, nodeId, revision: project.revision }));
    })}>{t("Проверить выбранный слой")}</button>
    <button disabled={busy || __STUDIO_DEMO__} onClick={() => void run(async () => {
      setBundle(await client.request("handoff", { pageId: page.screenId, revision: project.revision }));
    })}>{t("Подготовить экспорт экрана")}</button>
    {busy && <p role="status">{t("Подготавливаем снимок документа…")}</p>}
    {inspection && <><p>{t("Ревизия")} {inspection.revision}{inspection.revision !== project.revision ? ` · ${t("Документ изменился, обнови inspect")}` : ""}</p><pre aria-label={t("Результат inspect")}>{JSON.stringify(inspection, null, 2)}</pre></>}
    {bundle && <>
      <p>{t("Ревизия")} {bundle.revision} · {bundle.supported ? t("Поддерживаемый экран") : t("Экспорт с ограничениями")}</p>
      <ul>{bundle.diagnostics.map((row, index) => <li key={index}>{row.code}: {row.message}</li>)}</ul>
      <p>{Object.keys(bundle.files).join(", ")}</p>
      <button onClick={download}>{t("Скачать React ZIP")}</button>
    </>}
    {__STUDIO_DEMO__ && <p>{t("Inspect и экспорт доступны в локальной студии.")}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
