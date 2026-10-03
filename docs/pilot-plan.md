# Локальная дизайн-студия: план технического пилота

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Выполнение последовательно в одной сессии; делегирование не требуется.

**Goal:** Проверить пригодность Puck для независимого формата экранов: вложенные компоненты, стабильные ID, ручное редактирование, внешняя правка и просмотр на двух ширинах.

**Architecture:** Отдельное React-приложение преобразует собственный JSON-документ в Puck Data и обратно через изолированный адаптер. Демонстрационная библиотека содержит Stack, Card, Text, Button и Metric. Это технический пилот редактора, предшествующий файловому сервису, MCP и Git-синхронизации.

**Tech Stack:** Node.js 22 LTS или новее, npm, TypeScript, React, Vite, `@puckeditor/core`, Vitest, Playwright. Конкретные совместимые версии фиксируются lockfile после установки и успешной проверки.

---

## Контекст, место выполнения и результат

Основание: утверждённая спецификация `docs/superpowers/specs/2026-10-03-local-design-studio-design.md`.
Этот план сохранён в product-repository для непрерывности обсуждения. Все перечисленные
ниже пути исходников относительны к **отдельному корню студии**, а не к product-repository.
Предлагаемое рабочее имя нового репозитория: `local-design-studio`.

При реализации создать отдельный каталог в доступном writable root либо запросить
положенное окружением разрешение на каталог рядом со product-repository. Не создавать студию
как новый workspace-пакет продукта. Новый проект не требует worktree чужого репозитория.
Если каталог уже существует, сначала проверить его содержимое и Git status.

До удалённой публикации использовать локальный Git. Создание GitHub-репозитория —
отдельная настройка после готового пилота; в этом плане не требуется существующий remote.
Перенести копии спецификации и плана в новый репозиторий при его создании.

Результат пилота: запускаемая демонстрация, unit-тесты преобразования, браузерная
проверка редактора, lockfile и отчёт с решением о пригодности Puck. Импорт/экспорт JSON
в пилоте является способом проверить переносимость файлов. Это **не автосохранение**
и не реализация полного MVP. Интерфейс не должен показывать «Сохранено локально»
после одного изменения React state.

## Карта файлов

```text
package.json                         команды запуска и проверок
package-lock.json                    проверенные версии зависимостей
tsconfig.json                        строгая проверка TypeScript
vite.config.ts                       Vite и Vitest
index.html                           точка входа
src/main.tsx                         запуск React
src/model/document.ts                типы и проверка собственного документа
src/model/document.test.ts           отказ для неверной структуры и ID
src/demo/document.ts                 небольшой вложенный экран
src/puck/bridge.ts                    преобразования в Puck и обратно
src/puck/bridge.test.ts               round-trip и стабильность ID
src/puck/config.tsx                  визуальные компоненты и поля
src/puck/selection.ts                ID выделения через адаптер API Puck
src/puck/selection.test.ts           root и вложенное выделение
src/pilot/App.tsx                    демонстрация, внешняя правка, import/export
src/pilot/styles.css                 минимальное оформление
playwright.config.ts                 запуск браузерной проверки
tests/editor.spec.ts                 ручная правка и внешнее обновление
docs/pilot-results.md                факты, ограничения и решение
README.md                            запуск и воспроизведение проверки
```

## Задача 1. Независимый проект и проверка зависимостей

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `.gitignore`.

- [ ] Проверить `node --version`, `npm --version`, наличие каталога и отсутствие пользовательских файлов. Не заменять существующий проект.
- [ ] В новом корне выполнить `git init`, затем `git switch -c codex/studio-pilot`.
- [ ] Проверить metadata пакетов: `npm view @puckeditor/core version peerDependencies`, `npm view vite engines`, `npm view vitest engines`. Если установленный Node не удовлетворяет engines, выбрать совместимую версию или использовать доступный более новый runtime; не отключать engine checks.
- [ ] Создать `package.json`:

```json
{
  "name": "local-design-studio",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:browser": "playwright test"
  }
}
```

- [ ] Выполнить `npm install --save-exact react react-dom @puckeditor/core`, затем `npm install --save-dev --save-exact typescript vite @vitejs/plugin-react vitest @types/react @types/react-dom @types/node @playwright/test`. При несовместимых engines применить совместимые версии, подтверждённые metadata. Сохранить конкретные версии в package.json и lockfile.
- [ ] Создать `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx",
    "strict": true, "noEmit": true, "skipLibCheck": true,
    "esModuleInterop": true, "resolveJsonModule": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "vite.config.ts", "playwright.config.ts"]
}
```

- [ ] Создать `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
export default defineConfig({ plugins: [react()], test: { environment: "node" } });
```

- [ ] Создать `index.html` с `<html lang="ru">`, UTF-8, viewport, `<div id="root"></div>` и `<script type="module" src="/src/main.tsx"></script>`. Создать временный `src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
const root = document.getElementById("root");
if (!root) throw new Error("ROOT_MISSING");
createRoot(root).render(<main>Пилот дизайн-студии</main>);
```

- [ ] В `.gitignore` записать `node_modules/`, `dist/`, `.studio/`, `.env*`, `test-results/`, `playwright-report/`.
- [ ] Выполнить `npm run build`. Ожидается exit 0 и локальный build. Сохранить `npm ls --depth=0` в отчёт установки.
- [ ] Коммит: `git add package.json package-lock.json tsconfig.json vite.config.ts index.html src/main.tsx .gitignore`, затем `git commit -m "chore: bootstrap isolated studio pilot"`.

## Задача 2. Канонический документ и тестовый экран

**Files:** `src/model/document.ts`, `src/model/document.test.ts`, `src/demo/document.ts`.

- [ ] Создать тесты до реализации: `parseScreen(demo)` возвращает документ; дубликат ID в дочернем слоте, schemaVersion 2 и Text со свойством `script` отклоняются. Запустить `npm test -- src/model/document.test.ts`; ожидается ошибка отсутствующего модуля.
- [ ] Создать типы и проверки в `document.ts`:

```ts
export const definitions = {
  Stack: { fields: ["gap"], slots: ["content"] },
  Card: { fields: ["title"], slots: ["content"] },
  Text: { fields: ["text"], slots: [] },
  Button: { fields: ["label"], slots: [] },
  Metric: { fields: ["label", "value"], slots: [] },
} as const;
export type Kind = keyof typeof definitions;
export type Node = {
  id: string; type: Kind; props: Record<string, string | number>;
  slots: Record<string, Node[]>;
};
export type Screen = {
  schemaVersion: 1; screenId: string; revision: number; name: string;
  viewport: { width: number }; nodes: Node[];
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_OBJECT");
  }
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error("UNKNOWN_FIELD");
  }
}
export function parseScreen(input: unknown): Screen {
  const doc = object(input);
  exact(doc, ["schemaVersion", "screenId", "revision", "name", "viewport", "nodes"]);
  const viewport = object(doc.viewport);
  exact(viewport, ["width"]);
  if (doc.schemaVersion !== 1 || typeof doc.screenId !== "string" || !doc.screenId ||
      typeof doc.name !== "string" || !Number.isInteger(doc.revision) ||
      (doc.revision as number) < 0 || typeof viewport.width !== "number" ||
      !Number.isInteger(viewport.width) || viewport.width < 320 ||
      viewport.width > 1920 || !Array.isArray(doc.nodes)) {
    throw new Error("INVALID_SCREEN");
  }
  const ids = new Set<string>();
  function node(input: unknown): Node {
    const value = object(input);
    exact(value, ["id", "type", "props", "slots"]);
    if (typeof value.id !== "string" || !value.id || ids.has(value.id)) {
      throw new Error("INVALID_NODE_ID");
    }
    ids.add(value.id);
    if (typeof value.type !== "string" ||
        !Object.hasOwn(definitions, value.type)) throw new Error("UNKNOWN_COMPONENT");
    const type = value.type as Kind;
    const definition = definitions[type];
    const props = object(value.props);
    exact(props, definition.fields);
    for (const field of definition.fields) {
      const prop = props[field];
      if (field === "gap") {
        if (typeof prop !== "number" || !Number.isFinite(prop) || prop < 0 || prop > 64) {
          throw new Error("INVALID_GAP");
        }
      } else if (typeof prop !== "string" || prop.length > 1000) {
        throw new Error("INVALID_TEXT");
      }
    }
    const slots = object(value.slots);
    exact(slots, definition.slots);
    const parsedSlots: Record<string, Node[]> = {};
    for (const slot of definition.slots) {
      if (!Array.isArray(slots[slot])) throw new Error("INVALID_SLOT");
      parsedSlots[slot] = (slots[slot] as unknown[]).map(node);
    }
    return { id: value.id, type, props: props as Node["props"], slots: parsedSlots };
  }
  return {
    schemaVersion: 1, screenId: doc.screenId, revision: doc.revision as number,
    name: doc.name, viewport: { width: viewport.width }, nodes: doc.nodes.map(node),
  };
}
```

Пилот отклоняет неизвестный компонент. MVP расширит parser сохранением неизвестных
узлов и диагностической заглушкой согласно спецификации. Ограничить импорт в UI
размером 1 MiB до JSON.parse; большие или чрезмерно вложенные документы не входят
в приёмку пилота и не должны считаться поддержанными.

- [ ] Создать `src/demo/document.ts`:

```ts
import type { Screen } from "../model/document";
export const demo: Screen = {
  schemaVersion: 1, screenId: "budget", revision: 0,
  name: "Бюджет ремонта", viewport: { width: 390 },
  nodes: [{ id: "layout", type: "Stack", props: { gap: 16 }, slots: { content: [
    { id: "summary", type: "Card", props: { title: "Бюджет" }, slots: { content: [
      { id: "total", type: "Metric", props: { label: "Осталось", value: "240 000 ₽" }, slots: {} },
      { id: "note", type: "Text", props: { text: "Расходы на ремонт" }, slots: {} },
    ] } },
    { id: "add", type: "Button", props: { label: "Добавить расход" }, slots: {} },
  ] } }],
};
```

- [ ] Использовать такие конкретные проверки в `document.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { demo } from "../demo/document";
import { parseScreen } from "./document";
describe("screen", () => {
  it("accepts the fixture", () => expect(parseScreen(demo)).toEqual(demo));
  it("rejects unknown schema", () => {
    expect(() => parseScreen({ ...demo, schemaVersion: 2 })).toThrow();
  });
  it("rejects duplicate nested ID", () => {
    const doc = structuredClone(demo);
    doc.nodes[0].slots.content[0].id = "layout";
    expect(() => parseScreen(doc)).toThrow("INVALID_NODE_ID");
  });
  it("rejects executable property", () => {
    const doc = structuredClone(demo);
    doc.nodes[0].slots.content[0].slots.content[1].props.script = "alert(1)";
    expect(() => parseScreen(doc)).toThrow("UNKNOWN_FIELD");
  });
});
```

- [ ] Выполнить `npm test -- src/model/document.test.ts` и `npm run typecheck`. Ожидаются успешные проверки.
- [ ] Коммит: `git add src/model src/demo`, затем `git commit -m "feat: define portable pilot screen model"`.

## Задача 3. Изолированный адаптер Puck

**Files:** `src/puck/bridge.ts`, `src/puck/bridge.test.ts`, `src/puck/config.tsx`.

- [ ] До реализации записать тесты ниже в `bridge.test.ts` и запустить `npm test -- src/puck/bridge.test.ts`. Ожидается ошибка импорта.

```ts
import { expect, it } from "vitest";
import { demo } from "../demo/document";
import { fromPuck, toPuck } from "./bridge";
it("round-trips nested nodes and IDs", () => {
  expect(fromPuck(toPuck(demo), demo)).toEqual(demo);
});
it("preserves IDs after an edited text", () => {
  const data = toPuck(demo);
  const stack = data.content[0].props.content as Array<{ props: Record<string, unknown> }>;
  const children = stack[0].props.content as Array<{ props: Record<string, unknown> }>;
  children[1].props.text = "Новый текст";
  const result = fromPuck(data, demo);
  expect(result.nodes[0].slots.content[0].slots.content[1]).toEqual({
    id: "note", type: "Text", props: { text: "Новый текст" }, slots: {},
  });
});
```

- [ ] Реализовать `bridge.ts`:

```ts
import { definitions, parseScreen, type Kind, type Node, type Screen } from "../model/document";
export type PuckNode = { type: Kind; props: Record<string, unknown> & { id: string } };
export type PilotData = { root: { props: Record<string, unknown> }; content: PuckNode[] };
export function toPuck(screen: Screen): PilotData {
  function convert(node: Node): PuckNode {
    const slots = Object.fromEntries(Object.entries(node.slots).map(
      ([name, children]) => [name, children.map(convert)],
    ));
    return { type: node.type, props: { ...node.props, ...slots, id: node.id } };
  }
  return { root: { props: {} }, content: screen.nodes.map(convert) };
}
export function fromPuck(data: PilotData, previous: Screen): Screen {
  function convert(node: PuckNode): Node {
    if (!Object.hasOwn(definitions, node.type)) throw new Error("UNKNOWN_COMPONENT");
    const definition = definitions[node.type];
    const props = Object.fromEntries(definition.fields.map(name => [name, node.props[name]]));
    const slots = Object.fromEntries(definition.slots.map(name => {
      const children = node.props[name];
      if (!Array.isArray(children)) throw new Error("INVALID_SLOT");
      return [name, children.map(convert)];
    }));
    return { id: node.props.id, type: node.type, props: props as Node["props"], slots };
  }
  return parseScreen({ ...previous, nodes: data.content.map(convert) });
}
```

Если установленный Puck имеет другую форму slots, адаптировать только bridge и тест
его фактического Data. Не сохранять Puck Data вместо собственного Screen. Связку
типов проверять через экспортируемый `Data` установленного пакета; не скрывать
несовместимость двойным cast через unknown.

- [ ] Создать `config.tsx` на документированном slot API. Базовый код:

```tsx
import type { Config } from "@puckeditor/core";
export const config: Config = { components: {
  Stack: {
    fields: { gap: { type: "number" }, content: { type: "slot" } },
    defaultProps: { gap: 16, content: [] },
    render: ({ gap, content: Content }) => <Content style={{ display: "flex", flexDirection: "column", gap }} />,
  },
  Card: {
    fields: { title: { type: "text" }, content: { type: "slot" } },
    defaultProps: { title: "Карточка", content: [] },
    render: ({ title, content: Content }) => <section style={{ padding: 16, border: "1px solid #ccc", borderRadius: 12 }}><h2>{title}</h2><Content /></section>,
  },
  Text: {
    fields: { text: { type: "textarea" } }, defaultProps: { text: "Текст" },
    render: ({ text }) => <p>{text}</p>,
  },
  Button: {
    fields: { label: { type: "text" } }, defaultProps: { label: "Действие" },
    render: ({ label }) => <button type="button" onClick={() => alert("Демонстрация без API")}>{label}</button>,
  },
  Metric: {
    fields: { label: { type: "text" }, value: { type: "text" } },
    defaultProps: { label: "Показатель", value: "0" },
    render: ({ label, value }) => <div><span>{label}</span><strong style={{ display: "block", fontSize: 28 }}>{value}</strong></div>,
  },
} };
```

- [ ] Запустить `npm test -- src/puck/bridge.test.ts`, затем `npm run typecheck`. Ожидается PASS без изменения ID.
- [ ] Коммит: `git add src/puck`, затем `git commit -m "feat: adapt canonical screens to Puck slots"`.

## Задача 4. Проверяемая демонстрация редактора

**Files:** `src/pilot/App.tsx`, `src/pilot/styles.css`, `src/main.tsx`, `src/puck/selection.ts`, `src/puck/selection.test.ts`.

- [ ] Реализовать App с `useState<Screen>(demo)`, отдельным `mountVersion`, сообщением об ошибке и текущим выделением. Puck получает `toPuck(screen)` и `key={mountVersion}`. Обычный onChange обновляет каноническую структуру через fromPuck **без изменения key**: ввод текста не должен терять фокус.
- [ ] Внешнее обновление меняет Screen, увеличивает revision и mountVersion. Пилот намеренно допускает remount при внешней правке; пригодность для MVP оценивается отдельно. Не выдавать эту демонстрацию за готовую общую undo/redo историю.

Минимальный цикл изменения:

```tsx
const [screen, setScreen] = useState<Screen>(demo);
const [mountVersion, setMountVersion] = useState(0);
const [error, setError] = useState("");
function accept(data: PilotData) {
  try {
    const next = fromPuck(data, screen);
    if (JSON.stringify(next.nodes) !== JSON.stringify(screen.nodes)) {
      setScreen({ ...next, revision: screen.revision + 1 });
    }
    setError("");
  } catch (error) {
    setError(error instanceof Error ? error.message : "INVALID_DOCUMENT");
  }
}
function externalChange() {
  const next = structuredClone(screen);
  function visit(nodes: Node[]) {
    for (const node of nodes) {
      if (node.id === "total") node.props.value = "180 000 ₽";
      for (const children of Object.values(node.slots)) visit(children);
    }
  }
  visit(next.nodes);
  next.revision += 1;
  setScreen(parseScreen(next));
  setMountVersion(value => value + 1);
}
```

Импорты: useState из React, Puck из `@puckeditor/core`, Screen/Node/parseScreen
из `../model/document`, demo из `../demo/document`, bridge из `../puck/bridge`,
config из `../puck/config`. Puck подключается с `viewports` 390 и 1280 и onChange
accept. Собственная общая история undo/redo в пилоте не реализуется: встроенная
история Puck может сброситься при внешнем обновлении, что фиксируется в отчёте.

- [ ] Использовать документированное `PuckApi.selectedItem` через usePuck в UI override или composition. Не разбирать синтаксис zone вручную. В `selection.ts` изолировать получение ID:

```ts
export function selectedId(api: {
  selectedItem: { props: { id: string } } | null | undefined;
}): string | null {
  return api.selectedItem?.props.id ?? null;
}
```

Внутри компонента, находящегося в контексте Puck, получить api через usePuck,
вычислить selectedId(api) и передать ID наверх через effect с зависимостями
`[id, onSelectionChange]`. Callback родителя стабилизировать useCallback.
Способ размещения observer в UI override проверить по типам установленного пакета;
observer не может находиться снаружи Puck provider.

Тесты `selection.test.ts` до реализации:

```ts
import { expect, it } from "vitest";
import { selectedId } from "./selection";
it("uses stable root ID", () => {
  expect(selectedId({ selectedItem: { props: { id: "layout" } } })).toBe("layout");
});
it("uses stable nested ID", () => {
  expect(selectedId({ selectedItem: { props: { id: "note" } } })).toBe("note");
});
it("clears missing selection", () => {
  expect(selectedId({ selectedItem: null })).toBeNull();
});
```

Эти unit-проверки лишь проверяют формат адаптера. Реальная доступность nested
selectedItem доказывается браузерным сценарием, не этими тестами. Если public API
не позволяет её получить, фиксировать неуспешный пилот вместо private store.
- [ ] Добавить видимый диагностический JSON собственного Screen, ID выделенного элемента, кнопку «Внешняя правка: 180 000 ₽» и предупреждение «Пилот: изменения в памяти, экспортируйте файл».
- [ ] Добавить экспорт:

```ts
function download(screen: Screen) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(screen, null, 2)], {
    type: "application/json",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${screen.screenId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] Добавить импорт через input type=file, ограничение 1 MiB, JSON.parse и parseScreen в try/catch. Успех заменяет документ и повышает mountVersion; ошибка оставляет прежний документ и показывает причину. Расширение файла не заменяет валидацию содержимого.
- [ ] Создать styles.css с системным шрифтом, отступом диагностической панели и читаемым pre. В main.tsx подключить `@puckeditor/core/puck.css`, styles.css и App вместо временного main. Не использовать StrictMode в первом диагностическом запуске, чтобы отдельно наблюдать onChange lifecycle; повторную проверку со StrictMode записать в отчёт.
- [ ] Выполнить `npm run build`, `npm test`, запустить `npm run dev -- --port 5178` и вручную проверить вложенную правку. Ожидается сохранение фокуса и корректный JSON.
- [ ] Коммит: `git add src`, затем `git commit -m "feat: expose editable pilot and portable JSON export"`.

## Задача 5. Браузерная проверка и решение по Puck

**Files:** `playwright.config.ts`, `tests/editor.spec.ts`, `docs/pilot-results.md`, `README.md`.

- [ ] Создать playwright.config.ts:

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:5178" },
  webServer: {
    command: "npm run dev -- --port 5178 --strictPort",
    url: "http://127.0.0.1:5178", reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] Написать браузерный тест: открыть страницу, проверить значение «240 000 ₽» в iframe, нажать внешнюю правку и проверить «180 000 ₽» в новом iframe. Использовать frameLocator('iframe').first(), locators по доступному тексту, не CSS-классы Puck.
- [ ] Добавить сценарий ручного редактирования: выбрать Text через холст, найти его поле через доступную подпись, ввести новый текст, проверить diagnostic JSON и неизменный ID `note`. Конкретное имя accessible поля взять из реально отрендеренного UI после задачи 4.
- [ ] Проверить экспорт/импорт: перехватить download, прочитать JSON, открыть новую browser context, импортировать файл и сравнить диагностический документ. Перезапуск без импорта должен открывать demo: это ожидаемая граница пилота.
- [ ] Выполнить `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser`. Если браузер отсутствует, установить Chromium через `npx playwright install chromium` с требуемым окружением разрешением на загрузку. Не обходить отказ сети другими инструментами.
- [ ] Сохранить скриншоты 390 и 1280 в тестовые артефакты и визуально проверить отсутствие обрезанного текста и корректность слотов.
- [ ] В `docs/pilot-results.md` записать фактические версии, команды и exit codes, поддержку вложенных ID/выделения, результат внешнего обновления, потери фокуса/выделения и ограничения истории. Не писать PASS до выполнения проверки.
- [ ] В README описать установку `npm ci`, запуск `npm run dev`, команды проверок и границу «экспорт файла вместо автосохранения». Добавить ссылки на спецификацию и отчёт.
- [ ] Коммит: `git add playwright.config.ts tests docs README.md`, затем `git commit -m "test: verify Puck pilot and record compatibility"`.

## Условия успешного пилота

1. Round-trip сохраняет ID всех вложенных компонентов и свойства.
2. Ручная правка изменяет собственный документ и не разрывает ввод текста.
3. Выделение сопоставляется со стабильным ID через документированный API.
4. Внешняя правка отображается на холсте, не теряя остальные данные.
5. Экспортированный JSON импортируется в чистой browser context.
6. Build, typecheck и meaningful unit/browser проверки проходят.

Remount при внешней правке может быть приемлем для пилота, но его цена фиксируется:
сброс выделения, скролла и внутренней истории. Для MVP потребуется управляемая
синхронизация через документированный dispatch или отдельный адаптер с восстановлением
UI; решение не скрывается под заявлением о готовой общей истории.

Если критерии 1–3 не проходят через public API, пилот заканчивается фактическим
отчётом о несовместимости. Следующая работа — пересмотр редактора, а не разработка
хранилища вокруг несовместимого формата.

## Покрытие полной спецификации последующими этапами

Это отдельные планы после подтверждения редактора, а не незавершённые задачи пилота.

| Этап | Что реализует | Как доказывается результат |
| --- | --- | --- |
| A: этот пилот | Реестр, вложенные слоты, ID, редактор, просмотр, переносимость | Round-trip и браузерная проверка |
| B: документы и файловый сервис | manifest, tokens, fixtures, версия схемы, операции, ревизии, undo/redo, квитанции, атомарная запись, блокировка писателя, восстановление, ограничение пути, origin/token | Отказ записи, restart, stale revision, duplicate request, symlink escape |
| C: работа из чата | MCP stdio, активная сессия, предложения, варианты, комментарии, решения, offline доступ к файлам | Реальное подключение клиента и правка выделенного узла, EDITOR_DISCONNECTED |
| D: Git и адаптер продукта | status/fetch/commit/push, fast-forward, dirty/diverged/failed push, recovery checkout, версия адаптера, компоненты product-repository | Bare remote тесты, чистый clone, три состояния бюджета на двух ширинах |

Готовность пилота не означает готовность полного MVP или подключение MCP к этому
чату. Первая рабочая студия считается готовой только после этапов B–D и их приёмки.

## Проверенные первичные источники

- [Puck: компонент редактора](https://puckeditor.com/docs/api-reference/components/puck) — lifecycle data, callbacks и viewports.
- [Puck: вложенные layouts](https://puckeditor.com/docs/integrating-puck/multi-column-layouts) — slot API.
- [Puck: AppState](https://puckeditor.com/docs/api-reference/data-model/app-state) — выделение; документация предупреждает о нестабильности этого состояния.
- [Puck: PuckApi](https://puckeditor.com/docs/api-reference/puck-api) — selectedItem и доступ API из контекста редактора.
- [MCP: создание сервера](https://modelcontextprotocol.io/docs/develop/build-server) — основа следующего этапа интеграции.

Источники проверены 2026-10-03. При установке сравнить их с public types конкретной
версии пакета; этот документ не заменяет проверку совместимости.
