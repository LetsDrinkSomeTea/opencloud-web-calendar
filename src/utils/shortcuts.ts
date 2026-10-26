/**
 * Whether a key press on the target may trigger a calendar shortcut: not while typing (inputs,
 * text areas, selects, content editables) and not inside dialogs, menus or drop downs.
 */
export function isShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  if (target instanceof HTMLElement && target.isContentEditable) return false
  return !target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], [role="combobox"], .oc-modal, .oc-drop'
  )
}
