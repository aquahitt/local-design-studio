import type { Operation } from "../core/operations";
import type { Project } from "../core/project";
import {
  alignSceneLayers,
  distributeSceneLayers,
} from "../core/geometry-commands";
import { sceneLayers } from "../core/scene";
import { useI18n } from "./i18n";

const actions = [
  {
    id: "left",
    label: "Выровнять по левому краю",
    path: "M4 3v18M8 6h12v4H8zM8 14h8v4H8z",
  },
  {
    id: "center",
    label: "Выровнять по центру горизонтально",
    path: "M12 3v18M4 6h16v4H4zM8 14h8v4H8z",
  },
  {
    id: "right",
    label: "Выровнять по правому краю",
    path: "M20 3v18M4 6h12v4H4zM8 14h8v4H8z",
  },
  {
    id: "top",
    label: "Выровнять по верхнему краю",
    path: "M3 4h18M6 8h4v12H6zM14 8h4v8h-4z",
  },
  {
    id: "middle",
    label: "Выровнять по центру вертикально",
    path: "M3 12h18M6 4h4v16H6zM14 8h4v8h-4z",
  },
  {
    id: "bottom",
    label: "Выровнять по нижнему краю",
    path: "M3 20h18M6 4h4v12H6zM14 8h4v8h-4z",
  },
  {
    id: "horizontal",
    label: "Равные промежутки по горизонтали",
    path: "M3 4v16M21 4v16M6 8h3v8H6zM15 6h3v12h-3z",
  },
  {
    id: "vertical",
    label: "Равные промежутки по вертикали",
    path: "M4 3h16M4 21h16M8 6h8v3H8zM6 15h12v3H6z",
  },
] as const;

export function GeometryActions({
  project,
  selectedIds,
  disabled,
  onCommand,
}: {
  project: Project;
  selectedIds: string[];
  disabled: boolean;
  onCommand: (generate: () => Operation[], description: string) => void;
}) {
  const { t } = useI18n();
  function generate(id: (typeof actions)[number]["id"]) {
    try {
      const operations =
        id === "horizontal" || id === "vertical"
          ? distributeSceneLayers(project, selectedIds, id)
          : alignSceneLayers(project, selectedIds, id);
      const nodes = new Map(
        project.pages
          .flatMap((page) => sceneLayers(page.nodes))
          .map((layer) => [layer.node.id, layer.node]),
      );
      // Repeating an already satisfied alignment should not create an undo step.
      return operations.filter((operation) => {
        if (operation.type !== "setNodeMetadata") return true;
        const previous = nodes.get(operation.nodeId)?.scene;
        return (
          previous &&
          Object.entries(operation.scene ?? {}).some(
            ([key, value]) =>
              typeof value === "number" &&
              Math.abs(value - Number(previous[key as keyof typeof previous])) >
                1e-9,
          )
        );
      });
    } catch (error) {
      const messages: Record<string, string> = {
        NEGATIVE_DISTRIBUTION_GAP: t(
          "Недостаточно места для равных промежутков. Раздвинь крайние объекты.",
        ),
        NODE_LOCKED: t("Выбранный слой или его потомок заблокирован."),
        NODE_NOT_SCENE: t("Выбери слои свободной сцены с заданной геометрией."),
        INSUFFICIENT_SELECTION: t(
          "Выбери независимые слои: два для выравнивания, три для промежутков.",
        ),
        MIXED_PAGE_SELECTION: t("Выбери слои одной страницы."),
      };
      throw new Error(
        messages[(error as Error).message.split(":")[0]] ??
          (error as Error).message,
      );
    }
  }
  return (
    <div
      className="layer-toolbar"
      role="group"
      aria-label={t("Выравнивание и промежутки")}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          aria-label={t(action.label)}
          title={t(action.label)}
          disabled={
            disabled ||
            selectedIds.length <
              (action.id === "horizontal" || action.id === "vertical" ? 3 : 2)
          }
          style={{
            minWidth: 40,
            minHeight: 40,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 8,
          }}
          onClick={() => onCommand(() => generate(action.id), t(action.label))}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={action.path} />
          </svg>
        </button>
      ))}
    </div>
  );
}
