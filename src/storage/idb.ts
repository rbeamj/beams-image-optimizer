/**
 * Minimal promise-based IndexedDB wrapper for saved Studio projects — no dependencies, one object store.
 * Every record is validated with isStoredProject before it leaves the database, so a corrupt or
 * version-skewed row can never reach the editor.
 */
import { isStoredProject, projectMeta, type ProjectMeta, type StoredProject } from '../editor/projects';

const DB_NAME = 'beams-studio';
const DB_VERSION = 1;
const STORE = 'projects';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable in this browser.'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  } finally {
    db.close();
  }
}

export function putProject(project: StoredProject): Promise<void> {
  return withStore<void>('readwrite', store => store.put(project));
}

export async function getProject(id: string): Promise<StoredProject | undefined> {
  const record = await withStore<unknown>('readonly', store => store.get(id));
  return isStoredProject(record) ? record : undefined;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const records = await withStore<unknown[]>('readonly', store => store.getAll());
  return records
    .filter(isStoredProject)
    .map(projectMeta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteProject(id: string): Promise<void> {
  return withStore<void>('readwrite', store => store.delete(id));
}
