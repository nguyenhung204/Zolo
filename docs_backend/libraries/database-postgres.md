# Database PostgreSQL Library

## Purpose

The database-postgres library provides a TypeORM-based abstraction layer for PostgreSQL database connections and operations across microservices. It standardizes entity definitions, repository patterns, and connection management while reducing boilerplate code required for data persistence. The library enforces consistent naming conventions, timestamp handling, and transactional patterns throughout the system.

This abstraction enables microservices to maintain independent database instances while sharing common repository interfaces and base entity definitions. Each microservice owns its database schema, ensuring loose coupling and independent deployment cycles while benefiting from shared data access patterns and type safety provided by TypeORM.

## Exported Modules

**DatabasePostgresModule**

The root module that establishes TypeORM connections to PostgreSQL databases using NestJS dependency injection patterns. It provides configuration methods for synchronous and asynchronous initialization, supporting dynamic connection parameters loaded from environment variables or configuration services. The module handles connection pooling, query logging, and entity registration automatically.

The module supports multiple simultaneous connections when microservices need to access different databases, though this pattern should be avoided in favor of service boundaries and inter-service communication through message patterns or HTTP APIs.

**AbstractPostgresRepository**

An abstract base class implementing common CRUD operations for any entity type through TypeScript generics. This repository pattern provides the following standardized methods:

- findById: Retrieves a single entity by primary key with optional relation loading
- findAll: Returns all entities matching optional filter criteria with pagination support
- create: Persists a new entity with automatic timestamp population
- update: Modifies an existing entity by ID with partial update support
- delete: Soft or hard deletes an entity based on configuration
- exists: Checks for entity existence without loading full entity data

Services extend this abstract repository and add domain-specific query methods while inheriting the standard operations. This approach ensures consistency in basic operations while allowing customization for complex queries, joins, or aggregations specific to each domain.

**BaseEntity / TimestampedEntity / SoftDeletableEntity**

Three abstract entity classes forming a hierarchy:

- `BaseEntity` — provides only `id: string` (UUID v4, `@PrimaryGeneratedColumn('uuid')`). All entities extend this.
- `TimestampedEntity extends BaseEntity` — adds `createdAt` (`@CreateDateColumn`) and `updatedAt` (`@UpdateDateColumn`). Most domain entities extend this.
- `SoftDeletableEntity extends TimestampedEntity` — adds `deletedAt: Date | null` (`@DeleteDateColumn`) and `isDeleted: boolean`. Used for entities that require soft-delete support.

Services choose the appropriate base class based on their auditing requirements. The primary key strategy (UUID) and column naming conventions are enforced by the base classes across all microservices.

**Transactional Outbox Infrastructure**

The library bundles a complete Transactional Outbox implementation under `libs/database-postgres/src/outbox/`:

- `OutboxEvent` entity (`outbox_events` table) — stores `aggregateType`, `aggregateId`, `eventType`, `payload` (JSONB), `status` (PENDING/PROCESSING/COMPLETED/FAILED), `kafkaTopic`, `kafkaKey`, `retryCount`, `lockedBy`, `lockedAt`, `idempotencyKey` (unique constraint), `nextRetryAt`. Indexed on `(status, createdAt)` and `(status, lockedAt)` for fast claiming and requeue queries.
- `OutboxRepository` — provides `create(entityManager, dto)` with idempotency (catches PostgreSQL error 23505 and silently returns the existing row), `claimPendingEvents(batchSize, instanceId)`, `markAsCompleted()`, `markAsFailed()` (increments `retryCount`, sets `nextRetryAt` with exponential backoff: `30s × 2^retryCount`, capped at 1h).
- `OutboxProcessor` (abstract) — services extend this and implement `publishEvent(event: OutboxEvent)`. The base class runs a `setInterval` every 5 seconds (default) to call `claimPendingEvents(batchSize=100)` and publish each event. Configurable via `OutboxProcessorConfig` (`intervalMs`, `batchSize`, `maxRetries=3`, `processingTimeoutMs=300000`, `instanceId`).

## Configuration

Database connections require the following environment variables per microservice:

- DB_HOST: PostgreSQL server hostname or IP address
- DB_PORT: Database server port, defaulting to 5432
- DB_USERNAME: Authentication username for database access
- DB_PASSWORD: Authentication password for secure connections
- DB_DATABASE: Specific database name for the microservice
- DB_SYNCHRONIZE: Boolean flag for automatic schema synchronization

The synchronize option presents different behaviors based on environment. In development, setting synchronize to true allows TypeORM to automatically create and modify database schemas based on entity definitions, accelerating iteration speed and reducing manual migration management. However, this approach is extremely dangerous in production environments where automatic schema changes could result in data loss or unexpected modifications to live databases.

Production deployments must set synchronize to false and rely on explicit migration files managed through TypeORM migration commands. Migrations provide version control for database schemas, rollback capabilities, and explicit review processes before schema modifications reach production systems.

Connection pooling configuration allows tuning for specific workload characteristics. The default pool size of 10 connections works for moderate traffic patterns, but high-throughput services may require increasing the pool size to prevent connection exhaustion under load. Pool configuration also includes idle timeout settings to reclaim unused connections and maintain efficient resource utilization.

## Services Using This Library

**Users Service**

Maintains the users_db database containing user profile information synchronized with Keycloak identities. The database stores Keycloak subject identifiers as foreign keys, allowing profile enrichment beyond the authentication provider's data model. User entities include preferences, display settings, and application-specific metadata not suitable for storage in the identity provider.

**Conversation Service**

Operates tables in the `chat-db` PostgreSQL container (`chat_db` database), storing conversation metadata, participant lists, and conversation settings. The database maintains relationships between users and conversations through junction tables implementing many-to-many associations. This service owns conversation lifecycle management including creation, membership updates, and conversation settings modifications.

**Friendship Service**

Stores friendship data in the `users-db` PostgreSQL container (`users_db` database), sharing the container with the Users Service. The friendship tables persist friend relationships and friend requests, implementing directional relationships allowing asymmetric connections during the pending request phase and bidirectional active friendships once accepted.

**Message Store Service**

Manages tables in the `chat-db` PostgreSQL container (`chat_db` database), sharing the container with Conversation Service, as the permanent storage layer for all chat messages and read receipts. The message store maintains message content, metadata, timestamps, and delivery status independent of real-time message routing.

**Chat Core Service**

Does **not** own any database tables. All ACL validation is performed at runtime using data fetched via TCP and Redis (membership sets, role cache). Permission logic per conversation kind is embedded in Strategy classes — there is no `policy_rules` table.

The system uses 2 PostgreSQL containers (`users-db` on host port 5434, `chat-db` on host port 5433) plus Keycloak's own PostgreSQL container. Services sharing a container cannot access other services' tables directly without coordination.

## Design Notes

The repository pattern abstraction provides several architectural benefits while introducing certain tradeoffs that development teams must understand.

By centralizing common CRUD operations in the abstract repository, the system ensures consistent error handling, transaction management, and query patterns across all services. New developers can understand data access patterns quickly by examining the base repository rather than learning service-specific implementations. However, this abstraction can obscure performance characteristics of underlying queries, particularly when relation loading or complex joins occur behind simple method calls.

Services must extend the abstract repository rather than bypassing it with direct TypeORM repository usage. Direct usage circumvents the standardized patterns and makes it difficult to introduce cross-cutting concerns such as query logging, performance monitoring, or automatic soft deletion. The few exceptions where direct TypeORM usage is acceptable include complex aggregation queries, batch operations, or performance-critical hot paths where the abstraction overhead becomes measurable.

The BaseEntity design decision to use UUID primary keys rather than auto-incrementing integers provides several advantages at the cost of increased storage and index size. UUIDs eliminate coordination requirements when generating identifiers across distributed services or during database replication scenarios. They prevent information leakage about entity counts or creation order that auto-incrementing sequences expose through predictable identifier patterns. However, UUIDs require 16 bytes compared to 4 bytes for integers, increasing row size and index storage requirements. The database must also work harder to maintain indexes on random UUID values compared to sequential integers.

The createdAt and updatedAt timestamp fields provide basic auditing capabilities without implementing full audit logging. These timestamps answer when an entity was created or last modified but do not track who made changes, what specific fields changed, or why modifications occurred. Services requiring comprehensive audit trails must implement additional audit log tables or integrate with external audit logging systems.

The synchronize flag presents a significant operational risk if misunderstood. Development environments benefit from automatic schema synchronization during rapid iteration, but this feature must never be enabled in production. Teams should establish deployment pipelines that verify synchronize is explicitly set to false in production configurations, preventing accidental schema modifications during deployments. The pipeline should require explicit migration review and approval before schema changes reach production databases.

Transaction management occurs at the service layer rather than the repository layer, giving services control over transaction boundaries spanning multiple repository operations. The abstract repository provides transaction support through TypeORM's EntityManager and QueryRunner interfaces, but services must explicitly define transaction scopes to ensure consistency across multi-step operations.
