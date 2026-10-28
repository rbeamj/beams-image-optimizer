/**
 * Minimal promise-based IndexedDB wrapper for saved Studio data — no dependencies, three stores:
 * projects (whole photos with layers), templates (reusable looks), and queue (the Quick Optimize list).
 * Every record is validated before it leaves the database, so a corrupt or version-skewed row can
 * never reach the editor.
 */
import { isStoredProject, projectMeta, type ProjectMeta, type StoredProject } from '../editor/projects';
import { isStoredTemplate, templateMeta, type StoredTemplate, type TemplateMeta } from '../editor/templates';
import { isQueueRecord, type QueueRecord } from './queue';

const DB_NAME = 'beams-studio';
const DB_VERSION = 2;
const PROJECTS_STORE = 'projects';
const TEMPLATES_STORE = 'templates';
const QUEUE_STORE = 'queue';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(TEMPLATES_STORE)) db.createObjectStore(TEMPLATES_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable in this browser.'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab.'));
  });
}

async function withStore<T>(store: string, mode: IDBTransactionMode, run: (objectStore: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  } finally {
    db.close();
  }
}

// ---- projects ----

export function putProject(project: StoredProject): Promise<void> {
  return withStore<void>(PROJECTS_STORE, 'readwrite', store => store.put(project));
}

export async function getProject(id: string): Promise<StoredProject | undefined> {
  const record = await withStore<unknown>(PROJECTS_STORE, 'readonly', store => store.get(id));
  return isStoredProject(record) ? record : undefined;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const records = await withStore<unknown[]>(PROJECTS_STORE, 'readonly', store => store.getAll());
  return records.filter(isStoredProject).map(projectMeta).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteProject(id: string): Promise<void> {
  return withStore<void>(PROJECTS_STORE, 'readwrite', store => store.delete(id));
}

// ---- templates ----

export function putTemplate(template: StoredTemplate): Promise<void> {
  return withStore<void>(TEMPLATES_STORE, 'readwrite', store => store.put(template));
}

export async function getTemplate(id: string): Promise<StoredTemplate | undefined> {
  const record = await withStore<unknown>(TEMPLATES_STORE, 'readonly', store => store.get(id));
  return isStoredTemplate(record) ? record : undefined;
}

export async function listTemplates(): Promise<StoredTemplate[]> {
  const records = await withStore<unknown[]>(TEMPLATES_STORE, 'readonly', store => store.getAll());
  return records.filter(isStoredTemplate).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteTemplate(id: string): Promise<void> {
  return withStore<void>(TEMPLATES_STORE, 'readwrite', store => store.delete(id));
}

// ---- batch queue ----

export async function getQueue(): Promise<QueueRecord | undefined> {
  const record = await withStore<unknown>(QUEUE_STORE, 'readonly', store => store.get('queue'));
  return isQueueRecord(record) ? record : undefined;
}

export function putQueue(record: QueueRecord): Promise<void> {
  return withStore<void>(QUEUE_STORE, 'readwrite', store => store.put(record));
}
