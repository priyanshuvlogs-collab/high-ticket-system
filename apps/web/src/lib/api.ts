export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const DEMO_SLUG = process.env.NEXT_PUBLIC_DEMO_CLIENT_SLUG ?? "demo-coach";

const TOKEN_KEY = "bookedai_admin_token";

export function getAdminToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAdminToken(t: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* ignore */
  }
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getAdminToken()}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
