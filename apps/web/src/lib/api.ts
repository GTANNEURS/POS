const API_URL = import.meta.env.VITE_API_URL || "/api";

export type ApiOptions = RequestInit & { auth?: boolean };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = localStorage.getItem("gdt_access_token");
  const sessionScope = localStorage.getItem("gdt_session_scope");
  const headers = new Headers(options.headers || {});
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (options.auth !== false && token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (sessionScope === "command_validation") {
    headers.set("X-GDT-Session-Scope", "command_validation");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Erreur API");
  }

  return payload.data as T;
}
