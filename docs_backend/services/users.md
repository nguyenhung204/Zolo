# Users Service

## Overview

The Users Service is a TCP microservice responsible for managing user profile data within the system. It serves as the single source of truth for user profile information, acting as a synchronization layer between Keycloak authentication data and application-level user profiles. This service provides CRUD operations for user records and maintains bidirectional mapping between Keycloak user IDs and internal user IDs, enabling seamless integration between authentication and application domains.

This service does not handle authentication, authorization, or session management. It exclusively manages user profile metadata such as display names, email addresses, phone numbers, avatars, and preferences.

## Responsibilities

### What This Service IS Responsible For

- Creating, reading, updating, and deleting user profile records
- Maintaining mapping between Keycloak IDs and internal user IDs
- Providing find-or-create functionality to auto-sync users from Keycloak on first access
- Storing user profile metadata including username, email, phone, avatar URLs, bio, preferences
- Listing users with pagination support
- Searching users by username or email with pagination
- Validating user existence for other services
- Enforcing unique constraints on username and email within application database
- Tracking user creation and update timestamps
- Managing user soft-delete status if implemented

### What This Service IS NOT Responsible For

- User authentication or password management (handled by Keycloak)
- JWT token generation or validation (handled by Keycloak and Gateway)
- Authorization or role-based access control (handled by Keycloak)
- Session management or refresh tokens (handled by Keycloak)
- User presence or online/offline status (handled by Presence Service)
- Friendship relationships or social graph (handled by Friendship Service)
- User notifications or preferences for specific features (handled by respective services)
- Rate limiting or abuse detection
- Email verification or phone verification workflows (handled by Keycloak)

## External Communication

### HTTP Endpoints

None. This service is a TCP microservice and does not expose HTTP endpoints directly. All HTTP access is proxied through the Gateway service.

### TCP Message Patterns

**Pattern: `USERS_PATTERNS.CREATE_USER`**

- Purpose: Create a new user profile record
- Payload: username, email, phone (optional), avatar (optional), bio (optional)
- Response: Created user entity with generated ID and timestamps

**Pattern: `USERS_PATTERNS.GET_USER`**

- Purpose: Retrieve user profile by user ID (keycloakId from JWT sub)
- Payload: userId (VARCHAR 255 - Keycloak ID)
- Response: User entity or null if not found

**Pattern: `USERS_PATTERNS.FIND_OR_CREATE_FROM_KEYCLOAK`**

- Purpose: Find existing user by Keycloak ID or create new profile if not exists
- Payload: id (Keycloak ID), username, email, firstName, lastName (optional)
- Response: User entity (existing or newly created)
- Behavior: Idempotent; safe to call multiple times with same id

**Pattern: `USERS_PATTERNS.UPDATE_USER`**

- Purpose: Update user profile by user ID
- Payload: userId (Keycloak ID), partial user data (username, email, firstName, lastName, avatarUrl)
- Response: Updated user entity

**Pattern: `USERS_PATTERNS.DELETE_USER`**

- Purpose: Delete user profile by user ID
- Payload: userId (VARCHAR 255 - Keycloak ID)
- Response: Success boolean or error

**Pattern: `USERS_PATTERNS.LIST_USERS`**

- Purpose: Retrieve paginated list of all users
- Payload: page (default 1), limit (default 10, max 100)
- Response: Paginated response with data array and metadata (total, totalPages, hasNextPage, hasPreviousPage)

**Pattern: `USERS_PATTERNS.SEARCH_USERS`**

- Purpose: Search users by username or email with pagination
- Payload: query (search term), page, limit
- Response: Paginated response with matching users

### Timeout and Retry Behavior

- TCP requests timeout after default NestJS ClientProxy timeout (typically 10 seconds)
- No automatic retry logic at service level; clients must implement retry if needed
- Database query timeouts are handled by TypeORM default configuration (typically 30 seconds)
- Failed requests return structured error responses with error codes and messages

### Idempotency

- `CREATE_USER` is NOT idempotent; duplicate calls will fail due to unique constraints on username/email
- `FIND_OR_CREATE_FROM_KEYCLOAK` IS idempotent; safe to call multiple times with same id
- `UPDATE_USER` is idempotent for same payload
- `DELETE_USER` is idempotent; deleting non-existent user returns success
- `GET_USER`, `LIST_USERS`, `SEARCH_USERS` are inherently idempotent (read operations)

## Asynchronous Communication

### Kafka Events Published

None. This service does not publish Kafka events. User creation and updates are synchronous operations.

### Kafka Events Consumed

None. This service does not consume Kafka events. All operations are request-response via TCP.

### Event Processing Details

Not applicable. This service operates entirely on synchronous TCP communication patterns.

## Data Model

### Database Type

**PostgreSQL** - Relational database for structured user profile data with ACID guarantees.

### Tables

**Table: `users`**

- **id** (VARCHAR 255, Primary Key) - Keycloak user ID from JWT sub claim
- **username** (VARCHAR, Unique, Indexed) - User's display name
- **email** (VARCHAR, Unique, Indexed) - User's email address
- **firstName** (VARCHAR, Nullable) - User's first name
- **lastName** (VARCHAR, Nullable) - User's last name
- **avatarUrl** (VARCHAR, Nullable) - URL to user's avatar image (optional)
- **orgId** (VARCHAR, Nullable) - Organization ID for tenant isolation
- **title** (VARCHAR, Nullable) - Job title
- **departmentId** (VARCHAR, Nullable) - Department reference
- **accountStatus** (VARCHAR, Default: 'ACTIVE') - ACTIVE|SUSPENDED|OFFBOARDED
- **isActive** (BOOLEAN, Default: true) - Active status flag
- **createdAt** (TIMESTAMP) - Record creation timestamp
- **updatedAt** (TIMESTAMP) - Record last update timestamp

**Indexes:**

- Primary index on `id`
- Unique index on `username` for username uniqueness and search
- Unique index on `email` for email uniqueness and search
- Index on `orgId` for tenant queries
- Index on `accountStatus` for filtering

**Constraints:**

- NOT NULL on `id`, `username`, `email`
- UNIQUE on `username`, `email`

### Cache Usage

None. This service does not implement caching. User data is always fetched fresh from PostgreSQL. Caching may be added in the future at the Gateway layer or via Redis for frequently accessed profiles.

### Data Retention

- User records are retained indefinitely unless explicitly deleted
- Soft-delete pattern may be implemented to preserve referential integrity with other services
- No automatic data archival or cleanup currently implemented

## Dependencies

### Internal Microservices

None. This service operates independently and does not call other microservices.

### Shared Libraries

- `@app/common` - Shared utilities, constants, validation pipes, logging, configuration helpers
- `@app/database-postgres` - PostgreSQL database module providing connection pooling and TypeORM integration

### External Systems

**PostgreSQL:**

- Purpose: Persistent storage for user profile data
- Connection: Configured via environment variables (USERS_DB_HOST, USERS_DB_PORT, USERS_DB_USER, USERS_DB_PASSWORD, USERS_DB_NAME)
- Required: Yes (service cannot function without database)

**Keycloak:**

- Purpose: Source of truth for authentication and initial user data
- Interaction: Indirect via Gateway; this service only stores Keycloak IDs
- Required: No direct dependency (service does not call Keycloak directly)

## Important Behaviors

### User Lifecycle

1. User registers or logs in via Keycloak
2. Gateway calls `FIND_OR_CREATE_FROM_KEYCLOAK` with Keycloak user data (JWT sub as id)
3. Users Service checks if user exists by id (Keycloak ID)
4. If not exists, creates new user profile with Keycloak data
5. Returns user profile to Gateway
6. User can update profile via Gateway (which calls UPDATE_USER with Keycloak ID)
7. User deletion is permanent unless soft-delete is implemented

### Keycloak Synchronization

- This service does NOT automatically sync changes from Keycloak
- Profile updates must be explicitly triggered via UPDATE_USER patterns
- If username or email changes in Keycloak, application will not reflect changes unless manually updated
- Future enhancement may include Keycloak event webhooks or periodic sync jobs

### Processing Order

- User creation: Validate input → Check uniqueness → Insert to database → Return entity
- User update: Validate input → Fetch existing user → Update fields → Save to database → Return entity
- User search: Parse query → Build SQL LIKE query → Execute with pagination → Return results

### Consistency Model

- Strong consistency within single database transaction
- No distributed transactions; operations are atomic at database level
- Unique constraint enforcement ensures no duplicate usernames or emails
- No eventual consistency concerns since service does not interact with other services

### Error Handling

- Unique constraint violations return structured error with CONFLICT status
- Not found errors return null or structured error depending on operation
- Validation errors return detailed field-level error messages
- Database connection errors are logged and return INTERNAL_SERVER_ERROR status
- All errors include error codes, messages, and optional metadata for debugging

### Scalability

- Service is horizontally scalable; multiple instances can run concurrently
- Database connection pooling handles concurrent requests efficiently
- No shared in-memory state across instances
- Read-heavy workload benefits from database read replicas (not currently configured)
- Write operations are serialized at database level via unique constraints

## Configuration

### Required Environment Variables

- `USERS_SERVICE_PORT` - TCP service port (default: 3001)
- `USERS_DB_HOST` - PostgreSQL host (default: localhost)
- `USERS_DB_PORT` - PostgreSQL port (default: 5432)
- `USERS_DB_USER` - PostgreSQL username (default: postgres)
- `USERS_DB_PASSWORD` - PostgreSQL password
- `USERS_DB_NAME` - PostgreSQL database name (default: users_db)
- `NODE_ENV` - Environment mode (development, production)

### Optional Configuration

- `DB_POOL_SIZE` - Database connection pool size (default: TypeORM default, typically 10)
- `DB_SYNCHRONIZE` - Auto-sync database schema (default: true in development, false in production)
- `DB_LOGGING` - Enable SQL query logging (default: true in development, false in production)

### Feature Flags

None currently implemented.

### Runtime Assumptions

- PostgreSQL database is available and initialized with users table schema
- Database user has CREATE, READ, UPDATE, DELETE privileges
- Unique constraints on username, email are enforced at database level
- User IDs are valid Keycloak IDs (VARCHAR 255) from JWT sub claim
- Clients handle NOT_FOUND responses gracefully for GET operations
- Clients implement retry logic for transient database errors
- Database schema is pre-created via init scripts or migrations

## Design Notes

### Architectural Decisions

**Why TCP Instead of HTTP:**

TCP microservices are more efficient for internal service-to-service communication within the same network. Lower overhead, simpler protocol, and better performance compared to HTTP REST with JSON serialization.

**Why Separate from Keycloak:**

Keycloak is optimized for authentication and authorization, not application-specific profile data. Separating user profiles allows custom fields, faster queries, and independence from Keycloak schema changes.

**Why No Caching:**

User profile data changes infrequently and read latency is acceptable. Caching adds complexity and potential consistency issues. Future optimization may introduce Redis caching if read latency becomes bottleneck.

**Why Repository Pattern:**

Repository pattern abstracts data access logic, enabling easier testing with mock repositories and potential migration to different databases without changing service logic.

**Why No Kafka Events:**

User profile changes are synchronous and do not require asynchronous processing. Services that need user data can query Users Service directly or cache responses. Future enhancement may publish user_updated events for reactive invalidation.

### Trade-offs

**Strong Consistency vs Availability:**

This service prioritizes strong consistency over high availability. Unique constraints and ACID transactions ensure data integrity at the cost of potential write conflicts and database dependency.

**Synchronous Keycloak Sync vs Automatic Sync:**

Manual synchronization via `FIND_OR_CREATE_FROM_KEYCLOAK` is simple but requires Gateway to trigger sync. Automatic sync via Keycloak webhooks would improve freshness but adds complexity and failure modes.

**No Soft Delete vs Referential Integrity:**

Hard delete simplifies implementation but may break references in other services (e.g., messages from deleted users). Soft delete with isActive flag would preserve data integrity but requires filtering deleted users in all queries.

**No Caching vs Read Performance:**

No caching simplifies implementation and eliminates cache invalidation complexity. Read performance is acceptable for current scale, but may require caching layer for high-traffic scenarios.

### Future Extensions

- Implement Redis caching for frequently accessed user profiles with TTL-based invalidation
- Add Keycloak event webhook listener for automatic profile synchronization
- Implement soft-delete pattern with isActive flag to preserve referential integrity
- Publish `user.created`, `user.updated`, `user.deleted` Kafka events for reactive cache invalidation
- Add user preference storage for feature-specific settings (notifications, privacy, themes)
- Implement avatar upload and storage integration with object storage service
- Add full-text search capabilities for advanced user search
- Support bulk user operations for administrative tasks
- Add user activity tracking (last login, last seen)
- Implement user blocking and reporting metadata
- Add support for user badges, achievements, or reputation scores
- Implement GDPR compliance features (data export, right to be forgotten)
