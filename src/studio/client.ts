import type { Project } from "../core/project";
import type { Batch, Operation } from "../core/operations";
export interface Proposal {
  id: string;
  description: string;
  status: string;
  batch: Batch;
  createdAt: string;
  resultRevision?: number;
}
export class StudioClient {
  constructor(
    private token: string,
    private uiToken: string,
  ) {}
  static async connect() {
    if (__STUDIO_DEMO__) {
      const { BrowserDemoClient } = await import("../demo/client");
      return new BrowserDemoClient(window.localStorage);
    }
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error("Локальный сервис недоступен");
    const session = await response.json();
    return new StudioClient(session.token, session.uiToken);
  }
  async request<T>(path: string, data?: unknown, approve = false): Promise<T> {
    const response = await fetch("/api/" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(data === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "x-studio-ui-token": this.uiToken,
            }),
        ...(approve ? { "x-studio-ui-token": this.uiToken } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Ошибка локального сервиса");
    return result;
  }
  async materialize(value: unknown): Promise<unknown> {
    if (typeof value === "string" && value.startsWith("data:image/svg+xml,")) {
      const svg = decodeURIComponent(value.slice("data:image/svg+xml,".length));
      return (await this.request<{ path: string }>("assets", { svg })).path;
    }
    if (Array.isArray(value))
      return Promise.all(value.map((v) => this.materialize(v)));
    if (value && typeof value === "object")
      return Object.fromEntries(
        await Promise.all(
          Object.entries(value).map(async ([k, v]) => [
            k,
            await this.materialize(v),
          ]),
        ),
      );
    return value;
  }
  read() {
    return this.request<Project>("project");
  }
  apply(revision: number, operations: Operation[], description: string) {
    return this.request<Project>("operations", {
      requestId: crypto.randomUUID(),
      baseRevision: revision,
      description,
      author: "editor",
      operations,
    });
  }
  history(kind: "undo" | "redo", revision: number) {
    return this.request<Project>(kind, {
      requestId: crypto.randomUUID(),
      baseRevision: revision,
    });
  }
  proposals() {
    return this.request<Proposal[]>("proposals");
  }
  async approve(id: string) {
    await this.request(
      "proposals/" + encodeURIComponent(id) + "/approve",
      {},
      true,
    );
    return this.request<Project>(
      "proposals/" + encodeURIComponent(id) + "/apply",
      {},
    );
  }
}
