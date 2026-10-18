export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function inputIssue(file: Pick<File, 'type' | 'size'>) {
  if (!supportedTypes.has(file.type)) return 'Unsupported format. Choose JPEG, PNG, or WebP.';
  if (!Number.isFinite(file.size) || file.size < 1) return 'This image file is empty or invalid.';
  if (file.size > MAX_INPUT_BYTES) return 'This image is over the 50 MB local processing limit.';
  return undefined;
}
