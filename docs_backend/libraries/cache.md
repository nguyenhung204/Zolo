# Cache Library

## Purpose

The cache library provides a Redis-based abstraction layer for distributed caching across all microservices in the system. It offers a unified interface for storing and retrieving frequently accessed data, reducing database load and improving response times for read-heavy operations. The library wraps the ioredis client with NestJS-native dependency injection and provides additional utilities such as decorators for method-level caching and standardized TTL management patterns.

This library is essential for microservices that need to maintain high performance under load by caching expensive database queries, external API responses, or computed results. It supports both standalone Redis instances and cluster configurations for horizontal scalability.

## Exported Modules

**CacheModule**

The primary module that registers Redis connections and provides the CacheService throughout the application. It supports both synchronous and asynchronous configuration patterns through forRoot and forRootAsync methods respectively. The asynchronous configuration is particularly useful when connection parameters need to be loaded from external configuration services or environment-specific settings.

**CacheService**

The core service providing key-value operations with the following capabilities:

- `getClient(): Redis` — Returns the raw ioredis `Redis` instance for advanced operations (pipelines, Lua scripts, etc.)
- `get<T>(key): Promise<T | null>` — Retrieves a value by key with automatic JSON deserialization; returns `null` on miss or error
- `set(key, value, ttl = 3600): Promise<void>` — Stores a value with TTL in seconds (default 3600)
- `del(key): Promise<void>` — Removes a single key from the cache
- `delPattern(pattern): Promise<void>` — Removes all keys matching a glob pattern using cursor-based `SCAN` (avoids blocking the Redis event loop on large keyspaces)
- `tryLeaderLock(key, ttlMs): Promise<(() => Promise<void>) | null>` — Attempts to acquire a distributed leader lock via `SET NX PX`. Returns a `release()` closure when acquired, or `null` if another instance holds the lock. The release uses a Lua check-and-delete to prevent a slow job from releasing a lock re-acquired by another pod. Designed for cron jobs that should run on exactly one pod at a time.

The service handles serialization and deserialization transparently, allowing developers to store and retrieve complex objects without manual JSON operations.

**Cacheable Decorator**

A method-level decorator that automatically caches the return value of the decorated method based on input parameters. The decorator generates cache keys from method arguments and applies configurable TTL values. This pattern is particularly effective for pure functions or deterministic operations that benefit from memoization across service instances.

## Configuration

The library supports three Redis topology modes, selected by the `REDIS_TYPE` environment variable (default: `single`):

| `REDIS_TYPE` | Required env vars | Notes |
|---|---|---|
| `single` | `REDIS_HOST`, `REDIS_PORT` (defaults: localhost:6379) | Standard standalone Redis |
| `cluster` | `REDIS_NODES` (e.g. `host1:6379,host2:6379,host3:6379`) | Redis Cluster with sharding |
| `sentinel` | `REDIS_SENTINEL_NODES`, `REDIS_SENTINEL_MASTER` | HA sentinel setup |

Additional variables for all modes:
- `REDIS_PASSWORD`: Optional authentication password
- `REDIS_DB`: Database index (default 0)

All modes force `family: 4` (IPv4) to prevent IPv6 resolution issues in Docker environments.

Connection pooling is handled automatically by ioredis, with sensible defaults for maximum connections, idle timeouts, and retry strategies.

## Services Using This Library

**Gateway Service**

Caches JSON Web Key Sets retrieved from Keycloak to avoid repeated external HTTP requests during JWT verification. The JWKS cache uses a medium TTL of 600 seconds, balancing security requirements with performance optimization. Cache invalidation occurs automatically upon expiration rather than through active monitoring of Keycloak configuration changes.

**Chat Core Service**

Implements membership validation caching to quickly verify whether users are authorized to send messages to specific conversations. This prevents database queries on every message send operation, which would become a bottleneck under high message throughput. The cache stores conversation membership lists with a 600-second TTL.

**Friendship Service**

Maintains cached friend lists for each user to support real-time presence updates and authorization checks. When a user comes online, the system can quickly retrieve their friend list from cache to notify relevant parties without querying the friendship database. Cache entries use a 600-second TTL with cache-aside pattern for updates.

**Presence Service**

Stores online status information for connected users with short-lived TTL values of 60 seconds. The presence cache serves as the single source of truth for real-time user availability, with automatic expiration handling disconnected clients that fail to send heartbeats. This approach prevents stale presence data from persisting indefinitely.

**Realtime Gateway Service**

Leverages caching for two critical functions: conversation member lookups for message fanout and message deduplication. The conversation member cache reduces database load when broadcasting messages to large group conversations. The deduplication cache stores message identifiers with short TTL values to prevent duplicate delivery during network retries or client reconnections.

## Design Notes

The library implements three distinct TTL patterns based on data characteristics and access patterns:

Short-lived caches with 60-second TTL are appropriate for highly volatile data such as presence status or real-time counters where staleness is unacceptable. These caches prioritize freshness over hit rates.

Medium-duration caches with 600-second TTL balance staleness concerns with cache hit optimization for semi-stable data like conversation memberships or friend lists. These relationships change infrequently enough that a 10-minute window of potential staleness is acceptable given the performance benefits.

Long-duration caches with 3600-second TTL are reserved for rarely changing data such as public keys or system configuration. These caches maximize hit rates and minimize external dependencies for data that remains stable across hours.

The cache-aside pattern is used throughout the system rather than write-through or write-behind strategies. When a cache miss occurs, services retrieve the data from the authoritative source and populate the cache. Updates to the underlying data trigger cache invalidation or deletion rather than immediate cache updates, ensuring the authoritative database remains the single source of truth.

Services must implement their own cache key naming conventions to avoid collisions across microservices sharing the same Redis instance. The recommended pattern uses service name prefixes such as "gateway:jwks:" or "presence:user:" to namespace cache entries logically.

The library does not provide built-in distributed locking via a separate primitive — instead, `CacheService.tryLeaderLock()` provides a built-in leader lock using `SET NX PX` with Lua-based safe release.

Error handling follows a fail-open philosophy where cache failures do not prevent application functionality. If Redis becomes unavailable, services fall back to direct database queries rather than returning errors to clients. This approach prioritizes availability over performance during degraded states.
