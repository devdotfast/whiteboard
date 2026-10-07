/** Hold streamed files separately from presentation state and notify React in batches. */
import { fileIdentity, filePath, type FileChange, type DiffEvent, type DiffFile } from "./wire";
type StartEvent = Extract<DiffEvent, { type: "start" }>;
export interface Snapshot {
  /** The two ends of the comparison, from the start event. */
  comparison: { lhs: StartEvent["lhs"]; rhs: StartEvent["rhs"] } | null;
  /** The manifest, in comparison order. `files` and `failures` are indexed like it. */
  inventory: FileChange[];
  /** Each manifest file's diff, once it arrives. */
  files: (DiffFile | undefined)[];
  /** Each manifest file's error, once it fails. */
  failures: (string | undefined)[];
  loaded: number;
  errors: string[];
  complete: boolean;
}
export class DiffStore {
  private value: Snapshot = {
    comparison: null,
    inventory: [],
    files: [],
    failures: [],
    loaded: 0,
    errors: [],
    complete: false,
  };
  private slots = new Map<string, number>();
  private notification: ReturnType<typeof setTimeout> | undefined;
  private notify() {
    if (this.notification !== undefined || this.listeners.size === 0) return;
    // Stream reads can deliver many records in a single event-loop turn. Let input
    // and painting run, and rebuild the viewer at most once per frame-sized batch.
    this.notification = setTimeout(() => {
      this.notification = undefined;
      this.listeners.forEach((listener) => listener());
    }, 16);
  }
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.value;
  accept(event: DiffEvent) {
    if (event.type === "start") {
      this.slots = new Map(event.files.map((entry, index) => [fileIdentity(entry.file), index]));
      this.value = { ...this.value, comparison: { lhs: event.lhs, rhs: event.rhs }, inventory: event.files,
        files: event.files.map(() => undefined), failures: event.files.map(() => undefined) };
    }
    if (event.type === "file") {
      const slot = this.slots.get(fileIdentity(event.file));
      if (slot === undefined) throw new Error(`${filePath(event.file)} is not in the manifest`);
      if (this.value.files[slot] || this.value.failures[slot])
        throw new Error(`${filePath(event.file)} arrived twice`);
      if (event.diff) {
        const files = [...this.value.files];
        files[slot] = { ...event, diff: event.diff };
        this.value = { ...this.value, files, loaded: this.value.loaded + 1 };
      } else if (event.error) {
        const failures = [...this.value.failures];
        failures[slot] = event.error.message;
        this.value = { ...this.value, failures,
          errors: [...this.value.errors, `${filePath(event.file)}: ${event.error.message}`] };
      }
    }
    if (event.type === "complete")
      this.value = {
        ...this.value,
        complete: true,
        errors: event.aborted
          ? [...this.value.errors, `diffr stopped early: ${event.aborted.message}`]
          : this.value.errors,
      };
    this.notify();
  }
  fail(error: unknown) {
    this.value = {
      ...this.value,
      complete: true,
      errors: [...this.value.errors, String(error)],
    };
    this.notify();
  }
}
