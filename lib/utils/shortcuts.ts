export type GalleryQuickAction = 'archive' | 'favorite' | 'delete' | 'clear-selection';

export interface ShortcutKeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

export interface ShortcutContext {
  hasSelection: boolean;
  isModalOpen: boolean;
  isLightboxOpen: boolean;
  isEditable: boolean;
}

/**
 * Returns true if keyboard focus is inside a text input, textarea, select,
 * or contentEditable region where single-key shortcuts must not intercept typing.
 */
export function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Resolves global gallery quick-action keyboard shortcuts:
 * - 'A' -> toggle archive on selected items
 * - 'F' -> toggle favorite on selected items
 * - 'Delete' (or 'Backspace') -> move selected items to trash
 * - 'Escape' -> clear current selection
 */
export function resolveGalleryShortcut(
  event: ShortcutKeyEventLike,
  ctx: ShortcutContext
): GalleryQuickAction | null {
  if (ctx.isEditable || ctx.isModalOpen || ctx.isLightboxOpen) {
    return null;
  }
  if (!ctx.hasSelection) {
    return null;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  const lower = event.key.toLowerCase();
  if (lower === 'a') return 'archive';
  if (lower === 'f') return 'favorite';
  if (event.key === 'Delete' || event.key === 'Backspace') return 'delete';
  if (event.key === 'Escape') return 'clear-selection';
  return null;
}
