const formatters = new Map<string, Intl.DateTimeFormat>();

const OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

function formatterFor(locale: string): Intl.DateTimeFormat {
  const cached = formatters.get(locale);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(locale || undefined, OPTIONS);
  } catch {
    formatter = new Intl.DateTimeFormat(undefined, OPTIONS);
  }
  formatters.set(locale, formatter);
  return formatter;
}

export function formatKeyInstant(ms: number, locale: string): string {
  return formatterFor(locale).format(new Date(ms));
}
