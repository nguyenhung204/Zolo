import axios from "axios";
import { toast } from "sonner";
import { toApiError } from "@/lib/api/errors";
import { useAuthStore } from "@/stores/authStore";

const API_BASE_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: {
    "Content-Type": "application/json",
    "X-Client-Platform": "web",
  },
});

// Inject Bearer token on every request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Singleton refresh promise — deduplicate concurrent 401 retries
let refreshPromise: Promise<string> | null = null;

// On 401 — attempt token refresh once, queue all concurrent retries behind it
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retried) {
      error.config._retried = true;
      try {
        if (!refreshPromise) {
          refreshPromise = (async () => {
            const { refreshAccessToken } = await import("@/lib/auth/token");
            // Refresh token is in an HttpOnly cookie — no localStorage involved.
            const tokens = await refreshAccessToken();
            useAuthStore.getState().setAuth({ token: tokens.accessToken });
            return tokens.accessToken;
          })().finally(() => {
            refreshPromise = null;
          });
        }
        const newToken = await refreshPromise;
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return apiClient.request(error.config);
      } catch {
        useAuthStore.getState().clearAuth();
      }
    }

    // 429 – rate limit
    if (error.response?.status === 429) {
      toast.error("You are making too many requests. Please try again in a few minutes.", {
        id: "rate-limit",
        duration: 6000,
      });
    }

    // 400 – bad request (gentle inline warning, only if not already handled)
    if (error.response?.status === 400 && !error.config?._silent400) {
      const raw = (error.response?.data as { message?: string | string[] })?.message;
      const msg = Array.isArray(raw) ? raw[0] : raw;
      toast.warning(typeof msg === "string" && msg ? msg : "Invalid request. Please check your input.", {
        id: `bad-req-${String(error.config?.url ?? "")}`,
        duration: 4000,
      });
    }

    return Promise.reject(toApiError(error));
  }
);

/** Unwrap the standard BE response envelope { statusCode, data, metadata } */
export function unwrap<T>(res: { data: { data: T } }): T {
  return res.data.data;
}
