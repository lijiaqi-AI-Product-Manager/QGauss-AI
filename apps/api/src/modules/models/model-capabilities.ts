export function modelCapabilities(value: string | null | undefined): string[] {
  return [...new Set(String(value || '').split(',').map(value => value.trim()).filter(Boolean))];
}
