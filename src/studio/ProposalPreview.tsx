import { useI18n } from "./i18n";
import { DeviceFrame } from "./DeviceFrame";
import { useMemo, useState } from "react";
import type { Project } from "../core/project";
import { resolveTokens } from "../core/tokens";
import { libraryMetadata, type ComponentLibrary } from "../library/sdk";
import type { Proposal } from "./client";
import { buildProposalPreview } from "./proposalSimulation";
import { Preview } from "./Preview";

export function ProposalPreview({
  project,
  proposal,
  library,
}: {
  project: Project;
  proposal: Proposal;
  library: ComponentLibrary;
}) {
  const { t } = useI18n();

  const [chosen, setChosen] = useState("");
  const result = useMemo(
    () =>
      buildProposalPreview(project, proposal.batch, [libraryMetadata(library)]),
    [project, proposal.batch, library],
  );
  if (proposal.status === "applied" || proposal.status === "rejected")
    return null;
  if (result.error || !result.after)
    return (
      <p role="alert" className="notice">
        {result.error}
      </p>
    );
  const after = result.after;
  const id = result.pageIds.includes(chosen) ? chosen : result.pageIds[0];
  const beforePage = project.pages.find((p) => p.screenId === id);
  const afterPage = after.pages.find((p) => p.screenId === id);
  const oldTokens = resolveTokens(project.tokens, project.theme);
  const newTokens = resolveTokens(after.tokens, after.theme);
  const tokenNames = [
    ...new Set([...Object.keys(oldTokens), ...Object.keys(newTokens)]),
  ].filter(
    (name) =>
      JSON.stringify(oldTokens[name]) !== JSON.stringify(newTokens[name]),
  );
  return (
    <div
      className="proposal-preview"
      data-testid={"proposal-preview-" + proposal.id}
    >
      <p className="proposal-preview-caption">
        {t("Предварительный просмотр · проект пока не изменён")}
      </p>
      {result.pageIds.length > 1 && (
        <label>
          {t("Экран")}{" "}
          <select
            aria-label={t("Экран предложения")}
            value={id}
            onChange={(e) => setChosen(e.target.value)}
          >
            {result.pageIds.map((id) => (
              <option key={id} value={id}>
                {after.pages.find((p) => p.screenId === id)?.name ??
                  project.pages.find((p) => p.screenId === id)?.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!!result.pageIds.length && (
        <div className="proposal-comparison">
          {[
            { label: t("Сейчас"), doc: project, page: beforePage },
            { label: t("После принятия"), doc: after, page: afterPage },
          ].map(({ label, doc, page }) => (
            <section key={label}>
              <h3>{label}</h3>
              <p>
                {page
                  ? `${page.name} · ${page.viewport.width} × ${page.viewport.height ?? t("авто")}px · ${doc.theme}`
                  : label === t("Сейчас")
                    ? t("Новый экран")
                    : t("Экран будет удалён")}
              </p>
              {page ? (
                <div className="proposal-preview-scroll">
                  <div style={{ width: page.viewport.width }}>
                    <DeviceFrame
                      viewport={page.viewport}
                      theme={doc.theme}
                      fallbackHeight={520}
                    >
                      {(size) => (
                        <Preview
                          library={library}
                          project={doc}
                          theme={doc.theme}
                          title={label + " · " + page.name}
                          height={size.height}
                          nodes={page.nodes}
                        />
                      )}
                    </DeviceFrame>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  {label === t("Сейчас")
                    ? t("Экрана ещё нет")
                    : t("Экран отсутствует после принятия")}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {!!tokenNames.length && (
        <div className="proposal-token-changes">
          <h3>{t("Изменения токенов")}</h3>
          <table>
            <thead>
              <tr>
                <th>{t("Токен")}</th>
                <th>{t("Сейчас")}</th>
                <th>{t("После принятия")}</th>
              </tr>
            </thead>
            <tbody>
              {tokenNames.map((name) => (
                <tr key={name}>
                  <th>{name}</th>
                  {[oldTokens, newTokens].map((tokens, i) => (
                    <td key={i}>
                      {(after.tokens[name]?.type ??
                        project.tokens[name]?.type) === "color" &&
                        tokens[name] !== undefined && (
                          <span
                            className="proposal-color"
                            style={{ background: String(tokens[name]) }}
                          />
                        )}
                      {(after.tokens[name]?.type ??
                        project.tokens[name]?.type) === "fontFamily" &&
                        tokens[name] !== undefined && (
                          <span
                            style={{
                              fontFamily: String(tokens[name]),
                              marginRight: 8,
                            }}
                          >
                            {t("Aa Бб")}
                          </span>
                        )}
                      {["number", "dimension"].includes(
                        after.tokens[name]?.type ??
                          project.tokens[name]?.type ??
                          "",
                      ) &&
                        tokens[name] !== undefined && (
                          <span
                            aria-hidden="true"
                            style={{
                              display: "inline-block",
                              height: 8,
                              width: Math.max(
                                4,
                                Math.min(
                                  96,
                                  parseFloat(String(tokens[name])) || 4,
                                ),
                              ),
                              background: "#7489c7",
                              marginRight: 8,
                              borderRadius: 3,
                            }}
                          />
                        )}
                      <code>
                        {tokens[name] === undefined
                          ? t("Удалён / отсутствует")
                          : String(tokens[name])}
                      </code>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!result.pageIds.length && !tokenNames.length && (
        <p>{t("Визуальных изменений нет. Проверь точные операции ниже.")}</p>
      )}
    </div>
  );
}
