import { supabase } from "./supabaseClient";

// Initialize from localStorage at module load so the slug is set BEFORE any
// component fires its first request. CurrentColonyContext.loadColonies is
// async — without this, every initial dashboard fetch races and 422s.
const COLONY_LS_KEY = "databirdlab.currentColonySlug";
let currentColonySlug: string | null = (() => {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(COLONY_LS_KEY) : null;
  } catch {
    return null;
  }
})();

export const setApiClientColony = (slug: string | null) => {
  currentColonySlug = slug;
};

const SCOPED_PATH_PATTERNS = [
  /^\/api\/(surveys|arus|stats|detections|fusion|calibration|species_list|acoustic)/,
];

const needsColonyScope = (path: string) => SCOPED_PATH_PATTERNS.some((re) => re.test(path));

const buildUrl = (path: string) => {
  if (!needsColonyScope(path)) return path;
  if (!currentColonySlug) {
    console.warn("API call needs colony but none set:", path);
    return path;
  }
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}colony_slug=${encodeURIComponent(currentColonySlug)}`;
};

const authHeaders = async (): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const handle = async (res: Response) => {
  if (res.status === 401) {
    await supabase.auth.signOut();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? res.json() : res.text();
};

export const apiClient = {
  get: async (path: string) => {
    const res = await fetch(buildUrl(path), { headers: await authHeaders() });
    return handle(res);
  },
  post: async (path: string, body: any) => {
    const headers: Record<string, string> = await authHeaders();
    let opts: RequestInit;
    if (body instanceof FormData) {
      opts = { method: "POST", headers, body };
    } else {
      headers["Content-Type"] = "application/json";
      opts = { method: "POST", headers, body: JSON.stringify(body) };
    }
    const res = await fetch(buildUrl(path), opts);
    return handle(res);
  },
  patch: async (path: string, body: any) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(await authHeaders()) };
    const res = await fetch(buildUrl(path), { method: "PATCH", headers, body: JSON.stringify(body) });
    return handle(res);
  },
  delete: async (path: string) => {
    const res = await fetch(buildUrl(path), { method: "DELETE", headers: await authHeaders() });
    return handle(res);
  },
};
