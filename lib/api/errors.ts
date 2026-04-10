import axios from "axios";

type ErrorPayload = {
  message?: string | string[];
  error?: string;
  code?: string;
  errorCode?: string;
  details?: unknown;
};

export interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
}

function fromPayload(payload: unknown): ErrorPayload {
  if (!payload || typeof payload !== "object") return {};
  return payload as ErrorPayload;
}

function pickMessage(payload: unknown): string | undefined {
  const p = fromPayload(payload);

  if (Array.isArray(p.message)) {
    const first = p.message.find((item) => typeof item === "string" && item.trim().length > 0);
    if (first) return first;
  }

  if (typeof p.message === "string" && p.message.trim().length > 0) {
    return p.message;
  }

  if (typeof p.error === "string" && p.error.trim().length > 0) {
    return p.error;
  }

  return undefined;
}

export function toApiError(error: unknown, fallback = "Something went wrong."): ApiError {
  const apiError = new Error(fallback) as ApiError;

  if (axios.isAxiosError(error)) {
    const payload = error.response?.data;
    apiError.status = error.response?.status;
    apiError.message = pickMessage(payload) ?? error.message ?? fallback;
    const parsed = fromPayload(payload);
    apiError.code = parsed.code ?? parsed.errorCode;
    apiError.details = parsed.details;
    return apiError;
  }

  if (error instanceof Error) {
    apiError.message = error.message || fallback;
    return apiError;
  }

  return apiError;
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  return toApiError(error, fallback).message;
}