import { syncDirectory } from "./durability";
import { EventEmitter } from "node:events";
import { mkdir, open, lstat, rename, unlink, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CoreError,
  parseProject,
  migrateProject,
  stableStringify,
  type Project,
} from "./project";
import { applyBatch, type Batch } from "./operations";
type Receipt = { payload: string; project: Project };
type State = {
  previousProject?: Project;
  version: 1;
  project: Project;
  undo: Project[];
  redo: Project[];
  receipts: Record<string, Receipt>;
};
export type StoreOptions = { initialProject?: Project };
async function assertNoSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new CoreError("SYMLINK_FORBIDDEN", path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function readFile(path: string): Promise<Buffer>;
async function readFile(path: string, encoding: "utf8"): Promise<string>;
async function readFile(
  path: string,
  encoding?: "utf8",
): Promise<Buffer | string> {
  await assertNoSymlink(resolve(path, ".."));
  await assertNoSymlink(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return encoding ? await file.readFile(encoding) : await file.readFile();
  } finally {
    await file.close();
  }
}
async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function atomic(path: string, content: string) {
  await assertNoSymlink(resolve(path, ".."));
  await assertNoSymlink(path);
  const temporary = path + "." + randomUUID() + ".tmp";
  let renamed = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    renamed = true;
    await syncDirectory(resolve(path, ".."));
  } finally {
    if (!renamed) await unlink(temporary).catch(() => {});
  }
}
export class ProjectStore extends EventEmitter {
  private state!: State;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private blocked = false;
  private disk = "";
  private nonce = randomUUID();
  private constructor(public readonly root: string) {
    super();
  }
  static async open(
    root: string,
    options: StoreOptions = {},
  ): Promise<ProjectStore> {
    const store = new ProjectStore(resolve(root));
    await store.initialize(options);
    return store;
  }
  private path(name: string) {
    return join(this.root, ".studio", name);
  }
  private async boundaries(): Promise<void> {
    await assertNoSymlink(this.root);
    await assertNoSymlink(this.path(""));
    for (const name of [
      "state.json",
      "pending.json",
      "lock.json",
      "lock-reclaim.json",
    ])
      await assertNoSymlink(this.path(name));
    await assertNoSymlink(join(this.root, "project.json"));
  }
  private async initialize(options: StoreOptions) {
    await this.boundaries();
    await mkdir(this.root, { recursive: true });
    const projectFile = join(this.root, "project.json");
    const hasProject = await exists(projectFile);
    const hasPending = await exists(this.path("pending.json"));
    if (!hasProject && !hasPending) {
      if (!options.initialProject) throw new CoreError("PROJECT_NOT_FOUND");
      const entries = await readdir(this.root);
      if (entries.length) throw new CoreError("PROJECT_ROOT_NOT_EMPTY");
      parseProject(options.initialProject);
    }
    await mkdir(this.path(""), { recursive: true });
    await this.lock();
    try {
      if (await exists(this.path("pending.json"))) {
        const pending = this.parseState(
          await readFile(this.path("pending.json"), "utf8"),
        );
        if (pending.previousProject && (await exists(projectFile))) {
          const current = parseProject(
            JSON.parse(await readFile(projectFile, "utf8")),
          );
          if (
            stableStringify(current) !== stableStringify(pending.project) &&
            stableStringify(current) !==
              stableStringify(pending.previousProject)
          )
            throw new CoreError("EXTERNAL_CHANGE");
        }
        delete pending.previousProject;
        await this.materialize(pending);
      }
      if (hasProject || (await exists(projectFile))) {
        const bytes = await readFile(projectFile, "utf8");
        const parsed = JSON.parse(bytes);
        const project =
          parsed.schemaVersion === 1
            ? migrateProject(parsed)
            : parseProject(parsed);
        if (await exists(this.path("state.json"))) {
          this.state = this.parseState(
            await readFile(this.path("state.json"), "utf8"),
          );
          if (stableStringify(this.state.project) !== stableStringify(project))
            throw new CoreError("EXTERNAL_CHANGE");
        } else {
          this.state = {
            version: 1,
            project,
            undo: [],
            redo: [],
            receipts: {},
          };
          await this.materialize(this.state);
        }
        this.disk = await readFile(projectFile, "utf8");
      } else {
        this.state = {
          version: 1,
          project: parseProject(options.initialProject),
          undo: [],
          redo: [],
          receipts: {},
        };
        await atomic(
          this.path("pending.json"),
          stableStringify(this.state) + "\n",
        );
        await this.materialize(this.state);
        this.disk = await readFile(projectFile, "utf8");
      }
      await mkdir(join(this.root, "assets"), { recursive: true });
      await mkdir(join(this.root, "fixtures"), { recursive: true });
    } catch (error) {
      await this.release();
      throw error;
    }
  }
  private parseState(bytes: string): State {
    const s = JSON.parse(bytes) as State;
    if (
      s.version !== 1 ||
      !Array.isArray(s.undo) ||
      !Array.isArray(s.redo) ||
      !s.receipts
    )
      throw new CoreError("INVALID_STORE_STATE");
    s.project = parseProject(s.project);
    s.undo = s.undo.map(parseProject);
    s.redo = s.redo.map(parseProject);
    for (const receipt of Object.values(s.receipts))
      receipt.project = parseProject(receipt.project);
    return s;
  }
  private async lock() {
    await this.boundaries();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const file = await open(this.path("lock.json"), "wx", 0o600);
        try {
          await file.writeFile(
            JSON.stringify({ pid: process.pid, nonce: this.nonce }),
          );
          await file.sync();
        } finally {
          await file.close();
        }
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // Serialize stale-lock reclamation. Without this guard a delayed opener
        // could unlink the new owner's lock after another opener reclaimed it.
        let guard;
        try {
          guard = await open(this.path("lock-reclaim.json"), "wx", 0o600);
        } catch (guardError) {
          if ((guardError as NodeJS.ErrnoException).code === "EEXIST")
            throw new CoreError(
              "LOCKED",
              "Lock reclamation in progress; inspect stale reclamation guard manually",
            );
          throw guardError;
        }
        try {
          await guard.writeFile(
            JSON.stringify({ pid: process.pid, nonce: this.nonce }),
          );
          let previous: { pid: number; nonce: string };
          try {
            previous = JSON.parse(
              await readFile(this.path("lock.json"), "utf8"),
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw new CoreError(
              "LOCKED",
              "Unreadable lock; manual inspection required",
            );
          }
          if (!Number.isInteger(previous.pid) || previous.pid <= 0)
            throw new CoreError("LOCKED", "Invalid PID");
          try {
            process.kill(previous.pid, 0);
            throw new CoreError("LOCKED");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
          await unlink(this.path("lock.json"));
        } finally {
          await guard.close();
          await unlink(this.path("lock-reclaim.json"));
        }
      }
    }
    throw new CoreError("LOCKED");
  }
  private async release() {
    await assertNoSymlink(this.root);
    await assertNoSymlink(this.path(""));
    try {
      const lock = JSON.parse(await readFile(this.path("lock.json"), "utf8"));
      if (lock.nonce === this.nonce) await unlink(this.path("lock.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  read(): Project {
    return structuredClone(this.state.project);
  }
  private async materialize(state: State) {
    await atomic(
      join(this.root, "project.json"),
      stableStringify(state.project) + "\n",
    );
    await atomic(this.path("state.json"), stableStringify(state) + "\n");
    if (await exists(this.path("pending.json"))) {
      await unlink(this.path("pending.json"));
      await syncDirectory(this.path(""));
    }
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const queued = this.tail.then(task);
    this.tail = queued.catch(() => {});
    return queued;
  }
  private mutate(
    requestId: string,
    baseRevision: number,
    payload: unknown,
    transform: (state: State) => Project,
  ): Promise<Project> {
    return this.enqueue(async () => {
      if (this.closed) throw new CoreError("STORE_CLOSED");
      await this.boundaries();
      if (this.blocked) throw new CoreError("RECOVERY_REQUIRED");
      if (
        typeof requestId !== "string" ||
        !requestId ||
        requestId.length > 1000
      )
        throw new CoreError("INVALID_REQUEST_ID");
      const canonical = stableStringify(payload);
      const receipt = Object.hasOwn(this.state.receipts, requestId)
        ? this.state.receipts[requestId]
        : undefined;
      if (receipt) {
        if (receipt.payload !== canonical)
          throw new CoreError("REQUEST_ID_REUSED");
        return structuredClone(receipt.project);
      }
      if (
        (await readFile(join(this.root, "project.json"), "utf8")) !== this.disk
      )
        throw new CoreError("EXTERNAL_CHANGE");
      if (baseRevision !== this.state.project.revision)
        throw new CoreError("REVISION_CONFLICT");
      const next = structuredClone(this.state);
      const project = transform(next);
      next.project = project;
      Object.defineProperty(next.receipts, requestId, {
        value: { payload: canonical, project },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      let journal = false;
      try {
        await atomic(
          this.path("pending.json"),
          stableStringify({ ...next, previousProject: this.state.project }) +
            "\n",
        );
        journal = true;
        await this.materialize(next);
      } catch (error) {
        if (
          journal ||
          (await exists(this.path("pending.json")).catch(() => false))
        ) {
          this.blocked = true;
          throw new CoreError(
            "RECOVERY_REQUIRED",
            `Durable transaction pending; reopen to recover: ${String(error)}`,
          );
        }
        throw error;
      }
      this.state = next;
      this.disk = stableStringify(project) + "\n";
      this.emit("change", this.read());
      return this.read();
    });
  }
  apply(batch: Batch): Promise<Project> {
    return this.mutate(
      batch.requestId,
      batch.baseRevision,
      { kind: "apply", batch },
      (state) => {
        const next = applyBatch(state.project, batch);
        state.undo.push(state.project);
        state.redo = [];
        return next;
      },
    );
  }
  undo(requestId: string, baseRevision: number): Promise<Project> {
    return this.mutate(
      requestId,
      baseRevision,
      { kind: "undo", requestId, baseRevision },
      (state) => {
        const target = state.undo.pop();
        if (!target) throw new CoreError("NOTHING_TO_UNDO");
        state.redo.push(state.project);
        return parseProject({
          ...target,
          revision: state.project.revision + 1,
        });
      },
    );
  }
  redo(requestId: string, baseRevision: number): Promise<Project> {
    return this.mutate(
      requestId,
      baseRevision,
      { kind: "redo", requestId, baseRevision },
      (state) => {
        const target = state.redo.pop();
        if (!target) throw new CoreError("NOTHING_TO_REDO");
        state.undo.push(state.project);
        return parseProject({
          ...target,
          revision: state.project.revision + 1,
        });
      },
    );
  }
  async close(): Promise<void> {
    await this.tail;
    if (this.closed) return;
    this.closed = true;
    await this.release();
    this.removeAllListeners();
  }
}
