export function focusFirstInvalidField(container: HTMLElement | null): void {
  if (container == null) {
    return;
  }

  const target =
    container.querySelector<HTMLElement>(
      'input, textarea, button, [role="combobox"], [tabindex]:not([tabindex="-1"])'
    ) ?? container;

  if (typeof target.focus === 'function') {
    target.focus();
  }

  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

export function focusInvalidFieldFromMap<FieldKey extends string>(
  fieldKey: FieldKey | null,
  fieldRefs: Partial<Record<FieldKey, HTMLElement | null>>
): void {
  if (fieldKey == null) {
    return;
  }

  focusFirstInvalidField(fieldRefs[fieldKey] ?? null);
}
