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
        Предварительный просмотр · проект пока не изменён
      </p>
      {result.pageIds.length > 1 && (
        <label>
          Экран{" "}
          <select
            aria-label="Экран предложения"
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
            { label: "Сейчас", doc: project, page: beforePage },
            { label: "После принятия", doc: after, page: afterPage },
          ].map(({ label, doc, page }) => (
            <section key={label}>
              <h3>{label}</h3>
              <p>
                {page
                  ? `${page.name} · ${page.viewport.width}px · ${doc.theme}`
                  : label === "Сейчас"
                    ? "Новый экран"
                    : "Экран будет удалён"}
              </p>
              {page ? (
                <div className="proposal-preview-scroll">
                  <div style={{ width: page.viewport.width }}>
                    <Preview
                      library={library}
                      project={doc}
                      theme={doc.theme}
                      title={label + " · " + page.name}
                      height={520}
                      nodes={page.nodes}
                    />
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  {label === "Сейчас"
                    ? "Экрана ещё нет"
                    : "Экран отсутствует после принятия"}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {!!tokenNames.length && (
        <div className="proposal-token-changes">
          <h3>Изменения токенов</h3>
          <table>
            <thead>
              <tr>
                <th>Токен</th>
                <th>Сейчас</th>
                <th>После принятия</th>
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
                            Aa Бб
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
                          ? "Удалён / отсутствует"
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
        <p>Визуальных изменений нет. Проверь точные операции ниже.</p>
      )}
    </div>
  );
}
