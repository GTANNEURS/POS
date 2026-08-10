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

export function cleanDisplayText(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value
    .replace(/PiÃƒÆ’Ã‚Â¨ce|PiÃƒÂ¨ce|PiÃ¨ce|PiÃƒÆ’Â¨ce|PiÃ©ce/g, "Pièce")
    .replace(/MÃƒÆ’Ã‚Â¨tre|MÃƒÂ¨tre|MÃ¨tre|MÃƒÆ’Â¨tre/g, "Mètre")
    .replace(/D�p�t/g, "Dépôt")
    .replace(/DÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©pÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â´t/g, "Dépôt")
    .replace(/DÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©pÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â´t/g, "Dépôt")
    .replace(/DÃƒÆ’Ã‚Â©pÃƒÆ’Ã‚Â´t|DÃƒÂ©pÃƒÂ´t|DÃ©pÃ´t/g, "Dépôt")
    .replace(/ÃƒÆ’Ã‚Â©|ÃƒÂ©|Ã©/g, "é")
    .replace(/ÃƒÆ’Ã‚Â¨|ÃƒÂ¨|Ã¨/g, "è")
    .replace(/ÃƒÆ’Ã‚Â´|ÃƒÂ´|Ã´/g, "ô")
    .replace(/ÃƒÆ’Ã‚Âª|ÃƒÂª|Ãª/g, "ê")
    .replace(/ÃƒÆ’Ã‚Â¢|ÃƒÂ¢|Ã¢/g, "â")
    .replace(/ÃƒÆ’Ã‚Â |ÃƒÂ |Ã /g, "à")
    .replace(/ÃƒÆ’Ã‚Â§|ÃƒÂ§|Ã§/g, "ç");
}

export function cleanWarehouseName(value: string | null | undefined) {
  const cleaned = cleanDisplayText(value)
    .replace(/Entrepot/g, "Entrepôt")
    .replace(/Depot/g, "Dépôt");

  if (cleaned.includes("Central") && /D.|Ã|�/.test(value ?? "")) {
    return "Dépôt Central";
  }

  return cleaned;
}
