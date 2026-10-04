export interface Draft {
  value: string;
  source: string;
  baseRevision: number;
  dirty: boolean;
  conflict: boolean;
}
export function beginDraft(props: unknown, revision: number): Draft {
  const value = JSON.stringify(props, null, 2);
  return {
    value,
    source: value,
    baseRevision: revision,
    dirty: false,
    conflict: false,
  };
}
export function editDraft(draft: Draft, value: string): Draft {
  return { ...draft, value, dirty: value !== draft.source };
}
export function receiveDraft(
  draft: Draft,
  props: unknown,
  revision: number,
): Draft {
  if (!draft.dirty) return beginDraft(props, revision);
  return { ...draft, conflict: revision !== draft.baseRevision };
}
export function rebaseDraft(draft: Draft, revision: number): Draft {
  return { ...draft, baseRevision: revision, conflict: false };
}
