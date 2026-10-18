import type { ProgressEvent } from './types';

export async function runBatch<T, R>(items: T[], process: (item: T, index: number) => Promise<R>, onProgress?: (event: ProgressEvent) => void) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += 1) {
    try {
      const result = await process(items[index], index);
      results.push(result);
      onProgress?.({ index, completed: index + 1, total: items.length, filename: (items[index] as File).name || `Image ${index + 1}`, result: result as never });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      onProgress?.({ index, completed: index + 1, total: items.length, filename: (items[index] as File).name || `Image ${index + 1}`, error: normalized });
      if ((error as DOMException).name === 'AbortError') throw error;
    }
  }
  return results;
}
