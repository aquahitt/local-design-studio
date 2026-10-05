import { StudioClient, type Proposal } from "../studio/client";
import { applyBatch, type Batch } from "../core/operations";
import { parseProject, stableStringify, type Project } from "../core/project";
import { exampleLibrary } from "../library/example";
import { libraryMetadata } from "../library/sdk";
import { validateComponentProps } from "../service/schema";
import { demoProject } from "./project";
export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export const DEMO_STORAGE_KEY = "local-design-studio:public-demo:v1";
interface State {
  version: 1;
  project: Project;
  undo: Project[];
  redo: Project[];
  proposals: Proposal[];
  receipts: Record<string, { fingerprint: string; result: Project }>;
}
export class BrowserDemoClient extends StudioClient {
  private state: State;
  constructor(private storage: BrowserStorage) {
    super("", "");
    const saved = storage.getItem(DEMO_STORAGE_KEY);
    try {
      const state = saved ? JSON.parse(saved) : undefined;
      this.state = state ?? {
        version: 1,
        project: demoProject(),
        undo: [],
        redo: [],
        proposals: [],
        receipts: {},
      };
      if (
        this.state.version !== 1 ||
        !Array.isArray(this.state.undo) ||
        !Array.isArray(this.state.redo) ||
        !Array.isArray(this.state.proposals) ||
        !this.state.receipts
      )
        throw new Error("INVALID_DEMO_STATE");
      this.state.project = parseProject(this.state.project);
    } catch {
      throw new Error(
        "Данные демо повреждены. Нажми «Сбросить демо», чтобы открыть примеры заново.",
      );
    }
  }
  static async reset(storage: BrowserStorage) {
    const reset = () => storage.removeItem(DEMO_STORAGE_KEY);
    if (typeof navigator !== "undefined" && navigator.locks)
      await navigator.locks.request(DEMO_STORAGE_KEY, reset);
    else reset();
  }
  private commit(next: State) {
    this.storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
    this.state = next;
  }
  private applyBatch(batch: Batch, proposalId?: string): Project {
    const fingerprint = stableStringify(batch);
    const receipt = Object.hasOwn(this.state.receipts, batch.requestId)
      ? this.state.receipts[batch.requestId]
      : undefined;
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw new Error("REQUEST_ID_REUSED");
      return structuredClone(receipt.result);
    }
    const result = applyBatch(this.state.project, batch);
    validateComponentProps(result, [libraryMetadata(exampleLibrary)]);
    const next = structuredClone(this.state);
    next.undo.push(next.project);
    next.redo = [];
    next.project = result;
    Object.defineProperty(next.receipts, batch.requestId, {
      value: { fingerprint, result: structuredClone(result) },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    if (proposalId) {
      const p = next.proposals.find((p) => p.id === proposalId)!;
      p.status = "applied";
      p.resultRevision = result.revision;
    }
    this.commit(next);
    return structuredClone(result);
  }
  override async request<T>(path: string, data?: unknown): Promise<T> {
    const run = () => this.requestSnapshot<T>(path, data);
    if (typeof navigator !== "undefined" && navigator.locks)
      return navigator.locks.request(DEMO_STORAGE_KEY, run);
    return run();
  }
  private async requestSnapshot<T>(path: string, data?: unknown): Promise<T> {
    this.state = new BrowserDemoClient(this.storage).state;
    let result: unknown;
    const input = data as any;
    if (path === "project") result = structuredClone(this.state.project);
    else if (path === "context") result = { connected: false, demo: true };
    else if (path === "operations") result = this.applyBatch(input as Batch);
    else if (path === "undo" || path === "redo") {
      if (input.baseRevision !== this.state.project.revision)
        throw new Error("REVISION_CONFLICT");
      const next = structuredClone(this.state);
      const previous = next[path].pop();
      if (!previous)
        throw new Error(
          path === "undo" ? "NOTHING_TO_UNDO" : "NOTHING_TO_REDO",
        );
      next[path === "undo" ? "redo" : "undo"].push(next.project);
      next.project = parseProject({
        ...previous,
        revision: next.project.revision + 1,
      });
      this.commit(next);
      result = next.project;
    } else if (path === "proposals" && data === undefined)
      result = this.state.proposals;
    else if (path === "demo/proposal") {
      const next = structuredClone(this.state);
      const id = crypto.randomUUID();
      const nodes = next.project.pages.flatMap((p) => p.nodes);
      const text = nodes.find((n) => n.type === "Text");
      if (!text)
        throw new Error("Добавь Text на экран для примера предложения");
      const button = nodes.find((n) => n.type === "Button");
      const proposal: Proposal = {
        id,
        createdAt: new Date().toISOString(),
        description: "Пример: агент улучшает текст и действие",
        status: "pending",
        batch: {
          requestId: "demo-agent-" + id,
          baseRevision: next.project.revision,
          author: "Демо-агент (симуляция)",
          operations: [
            {
              type: "updateProps",
              nodeId: text.id,
              props: { text: "От идеи к интерфейсу — с помощью агента" },
            },
            ...(button
              ? [
                  {
                    type: "updateProps" as const,
                    nodeId: button.id,
                    props: { label: "Создать первый экран" },
                  },
                ]
              : []),
          ],
        },
      };
      next.proposals.push(proposal);
      this.commit(next);
      result = proposal;
    } else if (/^proposals\/[^/]+\/(approve|apply|reject)$/.test(path)) {
      const [, id, action] = path.split("/");
      const proposal = this.state.proposals.find((p) => p.id === id);
      if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
      if (action === "reject") {
        if (proposal.status === "applied")
          throw new Error("PROPOSAL_ALREADY_APPLIED");
        const next = structuredClone(this.state);
        next.proposals.find((p) => p.id === id)!.status = "rejected";
        this.commit(next);
        result = next.proposals.find((p) => p.id === id);
      } else if (action === "approve") {
        if (proposal.status === "rejected")
          throw new Error("PROPOSAL_REJECTED");
        if (proposal.batch.baseRevision !== this.state.project.revision)
          throw new Error("REVISION_CONFLICT");
        const next = structuredClone(this.state);
        next.proposals.find((p) => p.id === id)!.status = "approved";
        this.commit(next);
        result = next.proposals.find((p) => p.id === id);
      } else {
        if (proposal.status !== "approved" && proposal.status !== "applied")
          throw new Error("APPROVAL_REQUIRED");
        result = this.applyBatch(proposal.batch, id);
      }
    } else
      throw new Error(
        "Эта возможность доступна в локальной студии, а не в браузерном демо.",
      );
    return structuredClone(result) as T;
  }
}
