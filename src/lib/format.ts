export function formatEUR(n: number): string {
  return new Intl.NumberFormat('sl-SI', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n);
}

export function formatNum(n: number, digits = 2): string {
  return new Intl.NumberFormat('sl-SI', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('sl-SI', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Osnutek',
  sent: 'Poslano',
  accepted: 'Sprejeto',
  rejected: 'Zavrnjeno',
};
