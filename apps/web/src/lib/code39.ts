const CODE39_PATTERNS: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  "$": "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn"
};

const CODE39_ALLOWED = /^[0-9A-Z.\- $/+%]+$/;

export function normalizeCode39Value(value: string) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z.\- $/+%]/g, "");

  return normalized;
}

export function canEncodeCode39(value: string) {
  const normalized = normalizeCode39Value(value);
  return normalized.length > 0 && CODE39_ALLOWED.test(normalized);
}

export function buildCode39Svg(
  value: string,
  options?: {
    width?: number;
    height?: number;
    narrowBarWidth?: number;
    wideBarWidth?: number;
    quietZone?: number;
  }
) {
  const encodedValue = normalizeCode39Value(value);
  if (!encodedValue || !canEncodeCode39(encodedValue)) {
    return "";
  }

  const displayValue = `*${encodedValue}*`;
  const narrow = options?.narrowBarWidth ?? 2;
  const wide = options?.wideBarWidth ?? 5;
  const quietZone = options?.quietZone ?? 12;
  const height = options?.height ?? 54;

  let cursor = quietZone;
  const rects: string[] = [];

  for (let charIndex = 0; charIndex < displayValue.length; charIndex += 1) {
    const char = displayValue[charIndex];
    const pattern = CODE39_PATTERNS[char];
    if (!pattern) continue;

    for (let index = 0; index < pattern.length; index += 1) {
      const unit = pattern[index] === "w" ? wide : narrow;
      const isBar = index % 2 === 0;
      if (isBar) {
        rects.push(`<rect x="${cursor}" y="0" width="${unit}" height="${height}" rx="0.5" ry="0.5" fill="#111111" />`);
      }
      cursor += unit;
    }

    if (charIndex < displayValue.length - 1) {
      cursor += narrow;
    }
  }

  const totalWidth = Math.max(options?.width ?? 0, cursor + quietZone);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}" preserveAspectRatio="none" role="img" aria-label="${encodedValue}">
      <rect width="${totalWidth}" height="${height}" fill="#ffffff" />
      ${rects.join("")}
    </svg>
  `.trim();
}
