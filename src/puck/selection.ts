export function selectedId(api: {
  selectedItem: { props: { id: string } } | null | undefined;
}): string | null {
  return api.selectedItem?.props.id ?? null;
}
