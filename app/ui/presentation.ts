import { actionLabel } from '../model/actions';
import { canEdit, type EditorState } from '../model/editor';
import { physicalKey, type PhysicalKey } from '../model/layout';
export const mappingLabel = (id: string): string => id === 'protected.unknown' ? 'Unknown action · preserved' : actionLabel(id);
export function physicalName(key: PhysicalKey): string {
  return key.original.startsWith('modifier.') ? actionLabel(key.original).split(' / ')[0]! : key.legend;
}
export function keySpokenLabel(state: EditorState, key: PhysicalKey): string {
  const source = state.mode === 'offline' ? 'Last read in demo' : 'On demo board';
  const current = state.layer === 'fn' ? 'Fn layer unavailable. Not read' : `${source}: ${mappingLabel(state.baseline[key.id]!)}`;
  const pending = state.layer === 'base' ? state.draft[key.id] : undefined;
  return `${physicalName(key)}, physical key. ${current}${pending ? `. Staged mapping: ${mappingLabel(pending)}` : ''}${key.protection || state.layer === 'fn' ? '. Protected' : ''}`;
}
export function inspectorPresentation(state: EditorState) {
  const key = physicalKey(state.selected)!;
  const pending = state.draft[key.id];
  const protection = state.layer === 'fn' ? 'The Fn layer has no verified read or write path. It stays unavailable.' : key.protection;
  const editable = canEdit(state) && !protection;
  const same = state.target === (pending ?? state.baseline[key.id]);
  const action = pending && state.target === state.baseline[key.id] ? 'Remove staged change' : pending ? 'Update change' : 'Stage change';
  return {
    key, pending, protection, editable, same, action,
    currentLabel: state.mode === 'offline' ? 'Last read · demo' : 'On demo board',
    current: state.layer === 'fn' ? 'Not read' : mappingLabel(state.baseline[key.id]!),
    status: protection ? 'Protected' : pending ? 'Staged change' : 'Base layer',
  };
}
