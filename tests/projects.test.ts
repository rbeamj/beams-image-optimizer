import { describe, expect, it } from 'vitest';
import { isStoredProject, projectMeta, type StoredPoolEntry, type StoredProject, type StoredProjectData } from '../src/editor/projects';
import type { Snapshot } from '../src/editor/controller';
import { defaultScene } from '../src/editor/scene';
import { defaultAdjustments } from '../src/editor/looks';

const data = (over: Partial<StoredProjectData> = {}): StoredProjectData => ({
  fileName: 'shoe.png',
  fileType: 'image/png',
  file: new Blob(['file']),
  base: new Blob(['base']),
  matte: new Blob(['matte']),
  comparison: new Blob(['before']),
  backdropImage: null,
  width: 100,
  height: 80,
  pristine: { width: 100, height: 80 },
  removal: null,
  enhancedTo: null,
  refined: 0,
  cleaned: 0,
  adjustments: defaultAdjustments(),
  crop: { x: 0, y: 0, width: 100, height: 80 },
  scene: defaultScene(),
  backdrop: { kind: 'color', color: '#ffffff' },
  ...over,
});

const project = (over: Partial<StoredProject> = {}): StoredProject => ({
  id: 'p1', name: 'Studio look', createdAt: 1, updatedAt: 2, data: data(), ...over,
});

describe('isStoredProject', () => {
  it('accepts a complete record', () => {
    expect(isStoredProject(project())).toBe(true);
  });

  it('accepts records without a matte, an enhance level, or a backdrop image', () => {
    expect(isStoredProject(project({ data: data({ matte: null, enhancedTo: 2048 }) }))).toBe(true);
  });

  it('rejects records with a bad identity or timestamps', () => {
    expect(isStoredProject({ ...project(), id: 7 })).toBe(false);
    expect(isStoredProject({ ...project(), name: null })).toBe(false);
    expect(isStoredProject({ ...project(), updatedAt: 'soon' })).toBe(false);
    expect(isStoredProject({ ...project(), data: undefined })).toBe(false);
  });

  it('rejects missing or malformed blobs', () => {
    expect(isStoredProject(project({ data: data({ base: 'png' as unknown as Blob }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ file: null as unknown as Blob }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ matte: 'gray' as unknown as Blob }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ comparison: undefined }) }))).toBe(false);
  });

  it('rejects missing or malformed numbers', () => {
    expect(isStoredProject(project({ data: data({ width: 0 }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ pristine: { width: 100, height: null } as unknown as StoredProjectData['pristine'] }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ enhancedTo: '2048' as unknown as number }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ crop: { x: 0, y: 0, width: 100 } as unknown as StoredProjectData['crop'] }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ crop: { x: 0, y: 0, width: 100, height: 0 } }) }))).toBe(false);
  });

  it('rejects malformed look sections', () => {
    expect(isStoredProject(project({ data: data({ adjustments: { ...defaultAdjustments(), flipX: 'yes' as unknown as boolean } }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ scene: { ...defaultScene(), shadow: { opacity: 5 } as unknown as StoredProjectData['scene']['shadow'] } }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ backdrop: { kind: 3 } as unknown as StoredProjectData['backdrop'] }) }))).toBe(false);
  });

  it('requires an image backdrop to carry its image blob', () => {
    const imageBackdrop = { kind: 'image' as const, url: 'blob:old', fit: 'cover' as const };
    expect(isStoredProject(project({ data: data({ backdrop: imageBackdrop, backdropImage: null }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ backdrop: imageBackdrop, backdropImage: new Blob(['bg']) }) }))).toBe(true);
  });

  it('does not leak prototype keys into validity', () => {
    expect(isStoredProject(Object.assign(Object.create(null), project()))).toBe(true);
    expect(isStoredProject('project')).toBe(false);
    expect(isStoredProject(null)).toBe(false);
  });

  it('accepts an undo history only when its pool, snapshots and cursor are well formed', () => {
    const snapshot: Snapshot = {
      canvas: { objects: [{ type: 'image', src: 'blob:composite' }] },
      adjustments: defaultAdjustments(),
      crop: { x: 0, y: 0, width: 100, height: 80 },
      original: { width: 100, height: 80 },
      comparisonUrl: 'blob:before',
      scene: defaultScene(),
      backdrop: { kind: 'color', color: '#ffffff' },
      layers: { baseUrl: 'blob:base', width: 100, height: 80, matteUrl: 'blob:matte' },
      opaque: { left: 4, top: 2, width: 90, height: 70 },
    };
    const history = { snapshots: [snapshot], cursor: 0, pool: [{ url: 'blob:base', blob: new Blob(['b']) }, { url: 'blob:matte', blob: new Blob(['m']) }, { url: 'blob:before', blob: new Blob(['x']) }, { url: 'blob:composite', blob: new Blob(['c']) }] };
    expect(isStoredProject(project({ data: data({ history }) }))).toBe(true);
    expect(isStoredProject(project({ data: data({ history: null }) }))).toBe(true);
    expect(isStoredProject(project({ data: data({ history: { ...history, cursor: 4 } }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ history: { ...history, pool: [{ url: 'blob:base' }] as unknown as StoredPoolEntry[] } }) }))).toBe(false);
    expect(isStoredProject(project({ data: data({ history: { ...history, snapshots: [{ ...snapshot, comparisonUrl: 7 as unknown as string }] as Snapshot[] } }) }))).toBe(false);
  });
});

describe('projectMeta', () => {
  it('projects the list view without blobs', () => {
    const meta = projectMeta(project({ id: 'abc', name: 'Red shoe', updatedAt: 500, data: data({ fileName: 'shoe.png', width: 2178, height: 1788, backdrop: { kind: 'gradient', stops: [], angle: 90 } }) }));
    expect(meta).toEqual({ id: 'abc', name: 'Red shoe', createdAt: 1, updatedAt: 500, fileName: 'shoe.png', width: 2178, height: 1788, hasMatte: true, hasBackdropImage: false, backdropKind: 'gradient' });
  });

  it('reflects optional parts truthfully', () => {
    const meta = projectMeta(project({ data: data({ matte: null, backdrop: { kind: 'image', url: 'blob:x', fit: 'cover' }, backdropImage: new Blob(['bg']) }) }));
    expect(meta.hasMatte).toBe(false);
    expect(meta.hasBackdropImage).toBe(true);
  });
});
