/**
 * src/features/driveImport/editModeRoute.ts
 * Router state that asks the editor to open a page ready to type. Saved pages
 * otherwise open in read mode.
 */

export const EDIT_MODE_ROUTE_STATE = { openInEditMode: true } as const;

export function isEditModeRouteState(state: unknown): boolean {
  return (state as { openInEditMode?: unknown } | null)?.openInEditMode === true;
}
