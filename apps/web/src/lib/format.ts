export function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-MA", {
    style: "currency",
    currency: "MAD",
    maximumFractionDigits: 2
  }).format(value || 0);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-MA").format(value || 0);
}

export function formatDate(value: string | number | Date) {
  return new Intl.DateTimeFormat("fr-MA", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export function formatDateTime(value: string | number | Date) {
  return new Intl.DateTimeFormat("fr-MA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
