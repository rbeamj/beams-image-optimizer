import { editorFilter, type EditorState } from './state';

export function renderEditor(canvas: HTMLCanvasElement, image: HTMLImageElement, state: EditorState, compare = false) {
  const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.scale(dpr, dpr); const width = rect.width, height = rect.height; ctx.fillStyle = '#101b1f'; ctx.fillRect(0, 0, width, height);
  const base = Math.min(width / image.naturalWidth, height / image.naturalHeight) * state.zoom;
  const draw = (filtered: boolean) => { ctx.save(); ctx.translate(width / 2 + state.panX, height / 2 + state.panY); ctx.rotate(state.rotation * Math.PI / 180); ctx.scale((state.flipX ? -1 : 1) * base, (state.flipY ? -1 : 1) * base); ctx.filter = filtered ? editorFilter(state) : 'none'; ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2); ctx.restore(); };
  if (compare) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width / 2, height); ctx.clip(); draw(false); ctx.restore(); ctx.save(); ctx.beginPath(); ctx.rect(width / 2, 0, width / 2, height); ctx.clip(); draw(true); ctx.restore(); ctx.fillStyle = '#ffffff'; ctx.fillRect(width / 2 - 1, 0, 2, height); } else draw(true);
}
