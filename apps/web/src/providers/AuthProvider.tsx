import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { isNetworkError, isOfflineToken, loginOfflineCashier, rememberOfflineCashierLogin } from "../lib/offline";

type User = {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  defaultWarehouse: { id: string; name: string; code: string; type: string } | null;
};

type LoginCredentials =
  | { loginType: "admin"; email: string; password: string }
  | { loginType: "manager"; username: string; password: string }
  | { loginType: "caissier"; code: string };

type SessionScope = "full" | "command_validation";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  sessionScope: SessionScope;
  login: (credentials: LoginCredentials, options?: { scope?: SessionScope }) => Promise<User>;
  logout: () => Promise<void>;
  ready: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("gdt_access_token"));
  const [sessionScope, setSessionScope] = useState<SessionScope>(() => {
    const saved = localStorage.getItem("gdt_session_scope");
    return saved === "command_validation" ? "command_validation" : "full";
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) {
      setReady(true);
      return;
    }

    if (isOfflineToken(token)) {
      const cachedUser = localStorage.getItem("gdt_offline_user");
      if (cachedUser) {
        setUser(JSON.parse(cachedUser) as User);
      }
      setReady(true);
      return;
    }

    api<User>("/auth/me")
      .then((profile) => setUser(profile))
      .catch((error) => {
        if (isNetworkError(error)) {
          const cachedUser = localStorage.getItem("gdt_last_user");
          if (cachedUser) {
            setUser(JSON.parse(cachedUser) as User);
            setReady(true);
            return;
          }
        }
        localStorage.removeItem("gdt_access_token");
        setToken(null);
        setUser(null);
      })
      .finally(() => setReady(true));
  }, [token]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    sessionScope,
    ready,
    async login(credentials: LoginCredentials, options?: { scope?: SessionScope }) {
      let data: { accessToken: string; user: User };
      try {
        data = await api<{ accessToken: string; user: User }>("/auth/login", {
          method: "POST",
          auth: false,
          body: JSON.stringify(credentials)
        });
      } catch (error) {
        if (credentials.loginType === "caissier" && isNetworkError(error)) {
          const offlineUser = await loginOfflineCashier(credentials.code);
          if (offlineUser) {
            data = { accessToken: `offline:${offlineUser.id}`, user: offlineUser };
          } else {
            throw new Error("Connexion hors ligne impossible. Connecte ce caissier une fois en ligne sur cet ordinateur.");
          }
        } else {
          throw error;
        }
      }
      localStorage.setItem("gdt_access_token", data.accessToken);
      const nextScope = options?.scope === "command_validation" ? "command_validation" : "full";
      localStorage.setItem("gdt_session_scope", nextScope);
      localStorage.setItem(isOfflineToken(data.accessToken) ? "gdt_offline_user" : "gdt_last_user", JSON.stringify(data.user));
      if (credentials.loginType === "caissier" && !isOfflineToken(data.accessToken)) {
        await rememberOfflineCashierLogin(credentials.code, data.user);
      }
      setToken(data.accessToken);
      setSessionScope(nextScope);
      setUser(data.user);
      return data.user;
    },
    async logout() {
      if (!isOfflineToken(token)) {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
      }
      localStorage.removeItem("gdt_access_token");
      localStorage.removeItem("gdt_session_scope");
      localStorage.removeItem("gdt_offline_user");
      setToken(null);
      setSessionScope("full");
      setUser(null);
    }
  }), [ready, sessionScope, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

