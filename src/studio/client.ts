import { readStudioLocale, translate } from "./i18n";
import type { Project } from "../core/project";
import type { Batch, Operation } from "../core/operations";
import { readJsonResponse } from "./read-response";
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
  static async connect(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (__STUDIO_DEMO__) {
      const { BrowserDemoClient } = await import("../demo/client");
      return new BrowserDemoClient(window.localStorage);
    }
    const response = await fetch("/api/session", { signal });
    if (!response.ok)
      throw new Error(
        translate(readStudioLocale(), "Локальный сервис недоступен"),
      );
    const session = await response.json();
    return new StudioClient(session.token, session.uiToken);
  }
  async request<T>(
    path: string,
    data?: unknown,
    approve = false,
    options: {
      signal?: AbortSignal;
      onProgress?: (received: number, total?: number) => void;
    } = {},
  ): Promise<T> {
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
      signal: options.signal,
    });
    const result = (await readJsonResponse(response, options)) as T & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(
        result.error ??
          translate(readStudioLocale(), "Ошибка локального сервиса"),
      );
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
  read(
    options: {
      signal?: AbortSignal;
      onProgress?: (received: number, total?: number) => void;
    } = {},
  ) {
    return this.request<Project>("project", undefined, false, options);
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
  reject(id: string) {
    return this.request<Proposal>(
      "proposals/" + encodeURIComponent(id) + "/reject",
      {},
      true,
    );
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
