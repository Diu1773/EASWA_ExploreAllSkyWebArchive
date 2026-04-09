export function formatAnswerValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'Not provided';
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function formatMetric(value: number | undefined, digits = 4): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}
