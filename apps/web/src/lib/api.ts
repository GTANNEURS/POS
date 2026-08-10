function resolveApiUrl() {
  const raw = String(import.meta.env.VITE_API_URL ?? "").trim();
  if (!raw || raw === "/" || raw === "[SENSITIVE]") return "/api";
  return raw.replace(/\/+$/, "");
}

const API_URL = resolveApiUrl();

export type ApiOptions = RequestInit & { auth?: boolean };

type RefreshResponse = {
  accessToken: string;
  user: unknown;
};

async function refreshAccessToken() {
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false || !payload.data?.accessToken) {
    throw new Error("Session expiree.");
  }
  const data = payload.data as RefreshResponse;
  localStorage.setItem("gdt_access_token", data.accessToken);
  localStorage.setItem("gdt_last_user", JSON.stringify(data.user));
  window.dispatchEvent(new CustomEvent("gdt:token-refreshed", { detail: { accessToken: data.accessToken, user: data.user } }));
  return data.accessToken;
}

async function fetchApi(path: string, options: ApiOptions, token: string | null) {
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

  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers
  });
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = localStorage.getItem("gdt_access_token");
  let response = await fetchApi(path, options, token);

  if (response.status === 401 && options.auth !== false && token && !token.startsWith("offline:") && path !== "/auth/refresh") {
    try {
      const nextToken = await refreshAccessToken();
      response = await fetchApi(path, options, nextToken);
    } catch {
      localStorage.removeItem("gdt_access_token");
      window.dispatchEvent(new Event("gdt:session-expired"));
    }
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : {};
  if (!response.ok || payload.ok === false) {
    const message = typeof payload.message === "string" && payload.message.trim()
      ? payload.message
      : `Erreur API ${response.status} sur ${path}`;
    throw new Error(message);
  }

  return payload.data as T;
}
