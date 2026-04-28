# Operations Guide — ZoloChat Local Dev & Production

**Audience:** Backend engineers, DevOps, and QA running the stack locally or on a staging host.  
**Scope:** docker-compose orchestration, startup verification, log tailing, and quick-fixes for the Group Management release.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Full Stack Bootstrap](#2-full-stack-bootstrap)
3. [Service Start / Stop Cheatsheet](#3-service-start--stop-cheatsheet)
4. [Log Tailing](#4-log-tailing)
5. [Success Criteria](#5-success-criteria)
6. [Kafka Operations](#6-kafka-operations)
7. [Database Operations](#7-database-operations)
8. [Redis Operations](#8-redis-operations)
9. [Runbook: Group Management Topics Missing](#9-runbook-group-management-topics-missing)
10. [Runbook: Appointment Reminders Not Firing](#10-runbook-appointment-reminders-not-firing)
11. [Environment Variables Quick Reference](#11-environment-variables-quick-reference)

---

## 1. Prerequisites

| Tool | Min version | Notes |
|------|-------------|-------|
| Docker Engine | 24.x | `docker info` to verify |
| Docker Compose v2 | 2.24 | Installed as `docker compose` (no hyphen) |
| pnpm | 9.x | `pnpm --version` |
| Node.js | 22.x | Only needed for local test runs |

Ensure ports `3000`, `3001`, `3002`, `5433`, `5434`, `6380`, `8080`, `9092`, `29092` are free before first start.

---

## 2. Full Stack Bootstrap

### 2.1 First run (or after wiping volumes)

```bash
# Build all service images + initialise infrastructure (Kafka topics + Keycloak realm)
docker compose --profile kafka-init up --build -d
```

This single command:
1. Builds every service Dockerfile (multi-stage, results cached on subsequent runs).
2. Starts infrastructure (`zookeeper`, `kafka-1`, `redis-chat`, `users-db`, `chat-db`, `keycloak`).
3. Runs the `kafka-init` profile container which calls `scripts/init-kafka-topics-container.sh` to pre-create all Kafka topics including the 15 new `group.event.*` topics.
4. Starts all application services.

> **Tip:** The `kafka-init` profile container exits with code 0 after topic creation — this is expected. Verify with `docker compose ps kafka-init`.

### 2.2 Subsequent starts (images already built)

```bash
docker compose up -d
```

Topics already exist in Kafka — no need for `--profile kafka-init` again unless you wiped the `kafka_data` volume.

### 2.3 Rebuild a single service after code change

```bash
docker compose up -d --build conversation-service
```

### 2.4 Full teardown (keeps named volumes)

```bash
docker compose down
```

### 2.5 Full teardown including all data volumes

> **Destructive** — drops the Postgres databases and Kafka log segments.

```bash
docker compose down -v
```

After this, always restart with `--profile kafka-init` to recreate topics and re-seed the DB via init scripts.

---

## 3. Service Start / Stop Cheatsheet

| Goal | Command |
|------|---------|
| Start everything | `docker compose up -d` |
| Start with rebuild | `docker compose up -d --build` |
| Stop all (keep containers) | `docker compose stop` |
| Restart one service | `docker compose restart <service>` |
| Remove stopped containers | `docker compose down --remove-orphans` |
| Check container status | `docker compose ps` |

---

## 4. Log Tailing

### 4.1 Key services for Group Management

```bash
# API Gateway — inbound HTTP + WebSocket handshakes
docker compose logs -f gateway

# Conversation service — GroupMemberService, PollService, AppointmentService,
#                        InviteTokenService, GroupRoleGuard, BullMQ jobs
docker compose logs -f conversation-service

# Realtime gateway — Socket.IO room management, Kafka → Socket.IO fan-out
docker compose logs -f realtime-gateway

# Kafka broker — topic creation, consumer-group lag, rebalance events
docker compose logs -f kafka-1
```

### 4.2 Follow multiple services at once

```bash
docker compose logs -f gateway conversation-service realtime-gateway
```

### 4.3 Filter log output

```bash
# Only ERROR lines from conversation-service
docker compose logs -f conversation-service | grep -i error

# Watch BullMQ appointment worker activity
docker compose logs -f conversation-service | grep -i appointment

# Watch poll pessimistic-lock transactions
docker compose logs -f conversation-service | grep -i "poll\|lock"

# Watch invite-token events
docker compose logs -f conversation-service | grep -i "invite\|link"
```

### 4.4 Tail last N lines (useful for post-mortem)

```bash
docker compose logs --tail=200 conversation-service
```

### 4.5 Timestamps in logs

```bash
docker compose logs -f --timestamps conversation-service
```

---

## 5. Success Criteria

After `docker compose up -d`, verify the following log lines appear within 60 seconds.

### 5.1 Kafka broker ready

```
kafka-1  | [KafkaJS] Consumer has joined the group
```

or (earlier in startup):

```
kafka-1  | [2026-04-25 10:00:00,000] INFO [KafkaServer id=1] started (kafka.server.KafkaServer)
```

Verify from the init container:

```bash
docker compose logs kafka-init | grep "Kafka is ready"
# Expected: "Kafka is ready at kafka-1:29092"
```

### 5.2 All group.event.* topics exist

```bash
docker compose exec kafka-1 \
  kafka-topics --bootstrap-server localhost:29092 --list | grep "group.event"
```

Expected output (15 topics, sorted):
```
group.event.appointment_created
group.event.appointment_deleted
group.event.appointment_reminder
group.event.appointment_updated
group.event.disbanded
group.event.invite_link_reset
group.event.join_approved
group.event.join_rejected
group.event.join_requested
group.event.member_kicked
group.event.member_role_changed
group.event.poll_closed
group.event.poll_created
group.event.poll_voted
group.event.settings_updated
```

### 5.3 Redis connected

```bash
docker compose exec redis-chat redis-cli -p 6379 ping
# Expected: PONG
```

Application log line:

```
conversation-service | Redis connection established
```

### 5.4 NestJS services started

Each application service prints two lines on healthy startup:

```
<service> | [Nest] LOG [NestFactory] Starting Nest application...
<service> | [Nest] LOG [NestApplication] Nest application successfully started
```

For TCP microservices (conversation-service, etc.) also look for:

```
conversation-service | Microservice is listening
```

For HTTP-capable services (gateway):

```
gateway | [Nest] LOG [RouterExplorer] Mapped {/api/v1/..., GET} route
gateway | Server is running on port 3000
```

### 5.5 Group Management module loaded

```
conversation-service | [Nest] LOG [InstanceLoader] GroupModule dependencies initialized
```

### 5.6 BullMQ appointment worker ready

```
conversation-service | [Nest] LOG [AppointmentWorker] Worker started for queue: group.appointment
```

---

## 6. Kafka Operations

### 6.1 List all topics

```bash
docker compose exec kafka-1 \
  kafka-topics --bootstrap-server localhost:29092 --list | sort
```

### 6.2 Describe a topic (partitions, retention, replication)

```bash
docker compose exec kafka-1 \
  kafka-topics --bootstrap-server localhost:29092 \
  --describe --topic group.event.poll_voted
```

### 6.3 Check consumer group lag

```bash
docker compose exec kafka-1 \
  kafka-consumer-groups --bootstrap-server localhost:29092 \
  --describe --group conversation-service-group
```

A `LAG` of 0 on all partitions means the service is fully caught up.

### 6.4 Manually produce a test event (dev only)

```bash
docker compose exec kafka-1 \
  kafka-console-producer --bootstrap-server localhost:29092 \
  --topic group.event.member_kicked
# then type: {"conversationId":"test-conv","userId":"test-user","kickedBy":"admin"}
# Ctrl+D to finish
```

### 6.5 Consume and inspect events

```bash
docker compose exec kafka-1 \
  kafka-console-consumer --bootstrap-server localhost:29092 \
  --topic group.event.poll_voted \
  --from-beginning \
  --max-messages 10
```

### 6.6 Re-initialise topics after volume wipe

```bash
# Stop if running
docker compose down
# Remove Kafka data volume
docker volume rm nest_api_system_kafka_data || true
# Restart with topic init
docker compose --profile kafka-init up -d
```

---

## 7. Database Operations

### 7.1 Connect to chat-db (conversation/poll/appointment data)

```bash
docker compose exec chat-db \
  psql -U postgres -d chat_db
```

### 7.2 Verify Group Management schema applied

```sql
-- All 4 new columns on conversations
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'conversations'
  AND column_name IN ('is_public','join_approval_required','allow_member_message','link_version')
ORDER BY column_name;

-- New tables
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('group_join_requests','polls','appointments');
```

### 7.3 Check active polls

```sql
SELECT id, conversation_id, question, is_closed, deadline
FROM polls
WHERE is_closed = FALSE
ORDER BY created_at DESC
LIMIT 20;
```

### 7.4 Check upcoming appointments (next 24h)

```sql
SELECT id, conversation_id, title, scheduled_at, deleted_at
FROM appointments
WHERE deleted_at IS NULL
  AND scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
ORDER BY scheduled_at ASC;
```

### 7.5 Run migration manually (if init script didn't run)

```bash
docker compose exec chat-db \
  psql -U postgres -d chat_db \
  -f /docker-entrypoint-initdb.d/24-group-management.sql
```

---

## 8. Redis Operations

Redis is used by `GroupRoleGuard` for role caching.  
Cache key pattern: `group:roles:{conversationId}` (Hash, field=userId, value=MemberRole, TTL=3600s)

### 8.1 Connect to Redis

```bash
docker compose exec redis-chat redis-cli -p 6379
```

### 8.2 Inspect role cache for a group

```bash
# Replace <conversationId> with a real UUID
HGETALL "group:roles:<conversationId>"
# Returns: userId → role pairs for all cached members
```

### 8.3 Manually invalidate a group's role cache

```bash
DEL "group:roles:<conversationId>"
```

The guard will re-populate the cache on the next request.

### 8.4 Check cache TTL

```bash
TTL "group:roles:<conversationId>"
# Returns remaining seconds (3600 max). -2 = key does not exist.
```

### 8.5 Monitor live cache operations

```bash
docker compose exec redis-chat redis-cli -p 6379 MONITOR | grep "group:roles"
```

---

## 9. Runbook: Group Management Topics Missing

**Symptom:** `conversation-service` logs show `UnknownTopicOrPartitionException` for `group.event.*` topics.

**Cause:** Kafka was started without the `kafka-init` profile, or the topic-init container exited before creation.

**Fix:**

```bash
# 1. Check init container exit status
docker compose ps kafka-init

# 2. Re-run topic creation without a full restart
docker compose --profile kafka-init up kafka-init

# 3. Verify topics were created
docker compose exec kafka-1 \
  kafka-topics --bootstrap-server localhost:29092 --list | grep "group.event"

# 4. Restart affected services so they can reconnect to their topics
docker compose restart conversation-service realtime-gateway
```

---

## 10. Runbook: Appointment Reminders Not Firing

**Symptom:** No `group.appointment_reminder` Socket events at T-15min.

**Diagnosis steps:**

```bash
# 1. Check BullMQ queue status (conversation-service wraps Bull dashboard on :3010 in dev)
docker compose logs conversation-service | grep -i "appointment\|bullmq\|queue"

# 2. Check Redis for delayed jobs
docker compose exec redis-chat redis-cli -p 6379 \
  ZRANGE "bull:group.appointment:delayed" 0 -1 WITHSCORES

# 3. Check if outbox relay is draining
docker compose logs conversation-service | grep -i "outbox\|relay"

# 4. Check Kafka topic has messages
docker compose exec kafka-1 \
  kafka-console-consumer --bootstrap-server localhost:29092 \
  --topic group.event.appointment_reminder --from-beginning --max-messages 5
```

**Common causes and fixes:**

| Cause | Fix |
|-------|-----|
| `INVITE_JWT_SECRET` not set | Add to `.env` or compose environment block |
| BullMQ Redis connection refused | Ensure `redis-chat` is healthy: `docker compose ps redis-chat` |
| `scheduledAt` was in the past at creation | API returns 400; check client-side time zone handling |
| Job was already processed (idempotent) | Check idempotency key: `appointment-reminder:{appointmentId}:{jobId}` in outbox table |

---

## 11. Environment Variables Quick Reference

Variables relevant to the Group Management module (set in `docker-compose.yml` or a `.env` file at project root):

| Variable | Service | Purpose | Example |
|----------|---------|---------|---------|
| `INVITE_JWT_SECRET` | conversation-service | Signs/verifies invite link JWTs | `s3cr3t-change-me` |
| `APP_BASE_URL` | conversation-service | Prefix for generated invite URLs | `https://zolo.chat` |
| `KAFKA_BROKERS` | conversation-service | Kafka broker list | `kafka-1:29092` |
| `REDIS_HOST` | conversation-service | Redis hostname | `redis-chat` |
| `REDIS_PORT` | conversation-service | Redis port | `6379` |
| `ENABLE_KAFKA_TOPICS_INIT` | kafka-init container | Enable topic creation | `true` |
| `KAFKA_DEFAULT_PARTITIONS` | kafka-init container | Default partition count | `1` (dev), `3` (prod) |
| `KAFKA_HIGH_VOLUME_PARTITIONS` | kafka-init container | Partitions for high-volume topics | `1` (dev), `12` (prod) |
| `KAFKA_REPLICATION_FACTOR` | kafka-init container | Topic replication factor | `1` (dev), `3` (prod) |

---

*Last updated: 2026-04-25 — Group Management v1.0 release*
