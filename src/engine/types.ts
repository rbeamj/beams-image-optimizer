export type OutputFormat = 'jpeg' | 'png' | 'webp';
export interface OptimizeOptions { format: OutputFormat; quality?: number; maxEdge?: number; signal?: AbortSignal; background?: string; }
export interface ImageResult { blob: Blob; filename: string; sourceBytes: number; outputBytes: number; sourceWidth: number; sourceHeight: number; width: number; height: number; format: OutputFormat; }
export interface ProgressEvent { index: number; completed: number; total: number; filename: string; result?: ImageResult; error?: Error; }
