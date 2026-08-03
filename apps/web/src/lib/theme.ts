export type AppTheme = "dark" | "light";

const THEME_KEY = "gdt_app_theme_v1";

function isTheme(value: string | null): value is AppTheme {
  return value === "dark" || value === "light";
}

export function getStoredTheme(): AppTheme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_KEY);
  return isTheme(stored) ? stored : "dark";
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: AppTheme) {
  window.localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function initializeTheme() {
  applyTheme(getStoredTheme());
}
