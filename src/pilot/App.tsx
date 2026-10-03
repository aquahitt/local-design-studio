import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Puck,
  createUsePuck,
  type Data,
  type Viewports,
} from "@puckeditor/core";
import { demo } from "../demo/document";
import { parseScreen, type Node, type Screen } from "../model/document";
import { fromPuck, toPuck } from "../puck/bridge";
import { config } from "../puck/config";
import { selectedId } from "../puck/selection";

const usePuck = createUsePuck();
const viewports: Viewports = [
  { width: 390, label: "Телефон", icon: "Smartphone" },
  { width: 1280, label: "Компьютер", icon: "Monitor" },
];

function SelectionObserver({
  onSelection,
  children,
}: {
  onSelection: (id: string | null) => void;
  children: ReactNode;
}) {
  const id = usePuck((api) => selectedId(api));
  useEffect(() => onSelection(id), [id, onSelection]);
  return <>{children}</>;
}

export function App() {
  const [screen, setScreen] = useState<Screen>(demo);
  const current = useRef(screen);
  const [mountVersion, setMountVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Черновик в памяти");
  const [inspect, setInspect] = useState(false);
  const [dialog, setDialog] = useState(false);
  const onSelection = useCallback((id: string | null) => setSelected(id), []);
  const overrides = useMemo(
    () => ({
      headerActions: ({ children }: { children: ReactNode }) => (
        <SelectionObserver onSelection={onSelection}>
          {children}
        </SelectionObserver>
      ),
    }),
    [onSelection],
  );

  function replace(next: Screen) {
    current.current = next;
    setScreen(next);
    setMountVersion((value) => value + 1);
    setError("");
  }

  function accept(data: Data) {
    try {
      const previous = current.current;
      const next = fromPuck(data, previous);
      if (JSON.stringify(next.nodes) !== JSON.stringify(previous.nodes)) {
        next.revision = previous.revision + 1;
        current.current = next;
        setScreen(next);
        setStatus("Черновик в памяти");
        setError("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Неверный документ");
      setMountVersion((value) => value + 1);
      setStatus("Ввод отклонён · восстановлен корректный экран");
    }
  }

  function externalChange() {
    const next = structuredClone(current.current);
    let found = false;
    function visit(nodes: Node[]) {
      for (const node of nodes) {
        if (node.id === "total" && node.type === "Metric") {
          node.props.value = "180 000 ₽";
          found = true;
        }
        Object.values(node.slots).forEach(visit);
      }
    }
    visit(next.nodes);
    if (!found) {
      setError("В этом экране нет показателя total");
      return;
    }
    next.revision += 1;
    replace(parseScreen(next));
    setStatus("Внешняя правка применена · в памяти");
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(current.current, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${current.current.screenId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Экспорт передан браузеру");
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("Файл больше 1 МБ");
      replace(parseScreen(JSON.parse(await file.text())));
      setStatus("Файл открыт · изменения в памяти");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось открыть файл",
      );
    }
  }

  return (
    <main className="studio">
      <header className="studio-bar">
        <div className="brand">
          <span className="brand-mark">s</span>
          <div>
            <strong>studio / local</strong>
            <small>Интерфейсы в твоих файлах</small>
          </div>
        </div>
        <div className="project-name">
          <span className="project-dot" />
          {screen.name}
          <span className="pilot-tag">ПИЛОТ</span>
        </div>
        <nav aria-label="Действия с проектом">
          <label className="toolbar-button">
            Открыть JSON
            <input
              aria-label="Открыть JSON"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          <button className="toolbar-button primary" onClick={download}>
            Экспорт JSON ↗
          </button>
        </nav>
      </header>
      <section className="experiment-bar" aria-label="Инструменты пилота">
        <div>
          <span className="status-dot" />
          {status}
        </div>
        <div className="experiment-actions">
          <span className="selection" data-testid="selection">
            Выделено: {selected ?? "—"}
          </span>
          <button onClick={externalChange}>Внешняя правка</button>
          <button
            aria-pressed={inspect}
            onClick={() => setInspect((value) => !value)}
          >
            Структура {inspect ? "−" : "+"}
          </button>
        </div>
      </section>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="editor-shell">
        <Puck
          key={mountVersion}
          config={config}
          data={toPuck(screen)}
          height="calc(100dvh - 172px)"
          headerTitle={screen.name}
          onChange={accept}
          overrides={overrides}
          viewports={viewports}
          ui={{
            viewports: {
              current: { width: screen.viewport.width, height: "auto" },
              options: viewports,
              controlsVisible: true,
            },
          }}
          onAction={(_action, state) => {
            const width = state.ui.viewports.current.width;
            if (
              typeof width === "number" &&
              width !== current.current.viewport.width
            ) {
              const next = {
                ...current.current,
                viewport: { width },
                revision: current.current.revision + 1,
              };
              current.current = next;
              setScreen(next);
              setStatus("Черновик в памяти");
            }
          }}
          onPublish={() => setDialog(true)}
          dictionary={{ "header-publish": "Просмотр" }}
        />
      </div>
      <aside className="diagnostic" hidden={!inspect}>
        <div className="diagnostic-heading">
          <strong>Документ экрана</strong>
          <span>ревизия {screen.revision}</span>
        </div>
        <pre data-testid="document">{JSON.stringify(screen, null, 2)}</pre>
      </aside>
      <footer className="studio-footer">
        <span>
          Пилот: изменения в памяти. Экспортируй JSON перед закрытием.
        </span>
        <span>MCP и Git — следующий этап</span>
      </footer>
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Просмотр прототипа"
            className="modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Прототип готов к проверке</h2>
            <p>
              Холст уже показывает живые React-компоненты. Эта кнопка не
              публикует проект и не сохраняет его на диск.
            </p>
            <button
              className="toolbar-button primary"
              onClick={() => setDialog(false)}
            >
              Вернуться к экрану
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
