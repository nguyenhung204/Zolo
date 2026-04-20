# Gateway Service

## Overview

Gateway is the HTTP entrypoint for client requests. It does not contain domain business logic; it routes requests to backend microservices over TCP and standardizes HTTP behavior (auth, validation, response envelope, error mapping, logging).

## Runtime Pipeline (from source)

Implemented in `apps/gateway/src/main.ts` and `apps/gateway/src/gateway.module.ts`:

1. Trace middleware (`TraceIdMiddleware`) is applied to all requests.
2. Global interceptors:
   - `ResponseInterceptor` wraps successful responses into the standard envelope.
   - `HttpLoggingInterceptor` emits request/response logs and metrics.
3. Global exception filter: `GlobalExceptionFilter`.
4. Global validation pipe: `createValidationPipe()`.
5. CORS enabled with configured origin and headers including `X-Client-Platform`.
6. Global guards (`APP_GUARD`) in module registration order:
   - `ThrottlerGuard`
   - `SessionGuard`

## Authentication And Guard Model

### KeycloakGuard

`KeycloakGuard` lives in shared library code (`libs/common/src/auth/keycloak.guard.ts`) and is attached with `@UseGuards(KeycloakGuard)` on protected controllers/routes.

Behavior:

- Skips routes marked `@Public()`.
- Extracts `Authorization: Bearer <token>`.
- Validates token via `KeycloakService`.
- Injects decoded user into `request.user`.
- Enforces required roles from route metadata (`ROLES_KEY`) when present.

### SessionGuard (global)

`SessionGuard` (`apps/gateway/src/modules/auth/guards/session.guard.ts`) is an `APP_GUARD` and runs globally.

Behavior:

- Skips `@Public()` routes.
- If no `request.user` exists (for example route did not use `KeycloakGuard`), it allows through.
- If token has no `sid`, it allows through (unmanaged session case).
- Normalizes `x-client-platform` to `web | mobile` (defaults to `web` when invalid/missing).
- Validates SID against active session store:
  - Fast path: `SessionCacheService` in-memory cache (30s).
  - Slow path: Redis-backed `SessionStoreService`.
- Throws unauthorized when session missing or SID mismatch (`SESSION_REVOKED` / invalid token).

## Rate Limiting

- Global throttler baseline is configured to `60000` requests per `60_000ms` per IP.
- Call endpoints define stricter route-level limits via `@Throttle(...)` in `apps/gateway/src/modules/call/call.controller.ts`.

## Public HTTP Routes

From `apps/gateway/src/gateway.controller.ts` and module controllers:

- `GET /`
- `GET /health`
- `GET /health/circuit-breakers`
- `GET /conversations/health/outbox`
- `GET /calls/health`
- `GET /notifications/vapid-public-key`
- Auth routes under `/auth/*` are public except `POST /auth/logout`.

## Notification Routes Exposed By Gateway

Implemented in `apps/gateway/src/modules/notification/notification.controller.ts`:

- `GET /notifications/vapid-public-key` (public)
- `POST /notifications/devices` (JWT)
- `DELETE /notifications/devices/:deviceId` (JWT)
- `PUT /notifications/preferences` (JWT)
- `GET /notifications/preferences` (JWT)

These routes forward over TCP through `NotificationGatewayService` to notification-service patterns:

- `REGISTER_DEVICE`
- `UNREGISTER_DEVICE`
- `UPDATE_NOTIFICATION_PREF`
- `GET_NOTIFICATION_PREFS`

## Auth Routes Exposed By Gateway

From `apps/gateway/src/modules/auth/auth.controller.ts`:

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout` (requires JWT)
- `POST /auth/register/init`
- `POST /auth/register/verify-otp`
- `POST /auth/register/complete`
- `POST /auth/forgot-password`
- `POST /auth/verify-otp`
- `POST /auth/reset-password`

Reset flow is token-based:

1. `forgot-password` sends OTP.
2. `verify-otp` returns short-lived `resetToken`.
3. `reset-password` accepts `resetToken + newPassword`.

## Downstream Integration Summary

Gateway imports domain modules that each encapsulate TCP client communication to downstream services (users, conversation, chat-core, friendship, presence, media, call, notification, sticker).

Gateway itself remains an orchestration layer:

- HTTP transport and request lifecycle concerns are handled here.
- Domain ownership and persistence remain in downstream services.
