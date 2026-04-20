# Kafka Library

## Purpose

The kafka library provides a comprehensive abstraction layer for Apache Kafka integration, enabling event-driven communication patterns across microservices. It standardizes event production, consumption, error handling, and retry logic while hiding the complexity of Kafka client configuration and consumer group management. The library enables services to implement asynchronous communication patterns that decouple producers from consumers, allowing independent scaling and deployment of event publishers and subscribers.

This event-driven architecture supports several critical system capabilities including eventual consistency across service boundaries, asynchronous processing of non-critical operations, and audit trails of all significant state changes. Services publish domain events when state changes occur and consume events from other services to maintain localized views of distributed data without direct database coupling.

## Exported Modules

**KafkaModule**

The root module that establishes Kafka client connections and registers producers and consumers within the NestJS dependency injection container. It supports configuration through environment variables or programmatic initialization, handling connection lifecycle including graceful shutdown when services terminate. The module automatically discovers and registers consumer classes decorated with Kafka-specific decorators during application bootstrap.

**KafkaService**

The low-level Kafka client wrapper exposing administrative operations (topic creation, partition management, cluster metadata) via `getAdmin()` and `getKafka()`. Accepts `IKafkaConfig` (brokers, clientId, retry, connectionTimeout, requestTimeout, logLevel). Most services interact through the higher-level producer abstraction rather than `KafkaService` directly. `createTopics()` defaults to `numPartitions=12, replicationFactor=3`.

**KafkaProducerService**

The primary interface for publishing events to Kafka topics. The producer provides a publish method accepting a topic name and event payload, handling serialization, partition assignment, and delivery confirmation automatically. Key capabilities include:

Automatic serialization: Event objects are serialized to JSON before transmission, with support for custom serializers when binary formats or schema registries are required.

Partition key support: Events can specify partition keys to ensure related events route to the same partition, maintaining ordering guarantees for events about the same entity.

Retry logic: Transient failures during event publication trigger automatic retries with exponential backoff, ensuring reliable delivery without manual retry implementation in service code.

Delivery confirmation: The producer waits for broker acknowledgment before considering events published, configurable between fire-and-forget, leader acknowledgment, or full replica acknowledgment based on durability requirements.

The producer is injected as a singleton service, maintaining a persistent connection to Kafka brokers and reusing it across all event publications within a service instance.

**@KafkaHandler Decorator + KafkaConsumerRegistryService**

The consumer pattern in this library uses a decorator-based auto-discovery model rather than an abstract base class:

- `@KafkaHandler({ topic, groupId, fromBeginning? })` — method decorator that marks any service method as a Kafka consumer. The decorator stores `topic`, `groupId`, and `fromBeginning` metadata on the method.

`KafkaConsumerRegistryService` is an internal `OnModuleInit` service that:
1. Scans all NestJS providers via `DiscoveryService` and `MetadataScanner` to find `@KafkaHandler`-decorated methods.
2. Groups handlers by `groupId`, then creates **one KafkaJS consumer per group** (all topics for that group in a single subscription call).
3. Runs each consumer with `partitionsConsumedConcurrently: 12` for high throughput across the 12-partition message topics.
4. On handler failure: applies **1 inline retry**, then routes the message payload to the DLQ topic via `KafkaProducerService`.
5. **Consumer session tuning**: `sessionTimeout: 60000`, `heartbeatInterval: 6000`, `rebalanceTimeout: 60000` — gives Node.js headroom under DB back-pressure before the broker triggers a rebalance.
6. `onModuleDestroy()` disconnects all consumers gracefully.

Note: `KafkaConsumerRegistryService` is only registered when using `KafkaModule.forRootAsync()` (which imports `DiscoveryModule`). Producer-only services use `KafkaModule.forRoot()` which skips consumer auto-discovery.

**KafkaHandler Decorator**

A method-level decorator that binds consumer methods to specific topic and consumer group combinations. The decorator enables multiple consumer methods within a single service to subscribe to different topics or the same topic with different consumer groups for parallel processing patterns. Configuration includes topic name, consumer group identifier, and optional `fromBeginning` flag.

**KAFKA_TOPICS Constant**

A centralized registry of all topic names used throughout the system. Services import topic constants rather than using string literals, enabling compile-time validation of topic references. Key namespaces: `COMMANDS`, `EVENTS`, `FRIENDSHIP`, `USER`, `MEDIA`, `CALL`. Aliases for backward compatibility exist at the top level (e.g. `KAFKA_TOPICS.MESSAGE_ACCEPTED`).

**CONSUMER_GROUPS Constant**

Naming convention: `nest-chat.{service-name}[.{sub-group}]`. Key groups: `CHAT_CORE`, `CHAT_CORE_BLOCK_CACHE`, `CHAT_CORE_FRIEND_CACHE`, `MESSAGE_STORE`, `REALTIME_GATEWAY`, `CONVERSATION_SERVICE`, `CONVERSATION_FRIENDSHIP_EVENTS`, `CONVERSATION_CACHE_UPDATER`, `NOTIFICATION`, `MEDIA`, `MEDIA_WORKER`, `CALL_SERVICE`, `CALL_SERVICE_REALTIME`, `USERS_SERVICE`, `GATEWAY_CACHE_INVALIDATION`, `REALTIME_GATEWAY_USER_EVENTS`, `REALTIME_GATEWAY_DLQ`.

**DLQ Topics**

Three Dead Letter Queue topics under `KAFKA_TOPICS.DLQ`:
- `chat.dlq` (`DLQ.GENERAL`) — General DLQ
- `chat.dlq.commands` (`DLQ.COMMANDS`) — DLQ for command patterns
- `chat.dlq.events` (`DLQ.EVENTS`) — DLQ for domain events

## Configuration

Kafka connections require the following environment variables:

- KAFKA_BROKERS: Comma-separated list of broker addresses in host:port format
- KAFKA_CLIENT_ID: Unique identifier for this client instance, used in broker logs and metrics
- KAFKA_GROUP_ID: Default consumer group identifier for consumers not overriding group assignment
- KAFKA_CONNECTION_TIMEOUT: Maximum time to wait for initial broker connections
- KAFKA_REQUEST_TIMEOUT: Maximum time to wait for individual broker requests
- KAFKA_RETRY_ATTEMPTS: Number of retry attempts for transient failures
- KAFKA_RETRY_INTERVAL: Base interval between retry attempts before exponential backoff

Consumer group configuration determines how Kafka distributes partition assignments across service instances. Multiple instances of the same service using identical consumer group IDs form a consumer group where each partition is assigned to exactly one instance. This pattern enables horizontal scaling where additional service instances increase processing throughput by consuming from additional partitions.

Services requiring multiple independent processors for the same topic configure different consumer group IDs, causing each group to receive all events independently. This pattern supports scenarios where different services need to maintain different views of the same event stream or perform different operations in response to the same events.

## Services Using This Library

**Chat Core Service**

Acts as the primary event producer for chat messages, publishing events whenever messages are sent through the system. Events include message content, sender information, target conversation, and delivery metadata. The service publishes to the message creation topic, which multiple downstream services consume for persistence, delivery confirmation, and notification generation.

**Message Store Service**

Operates as both consumer and producer in the event pipeline. It consumes message creation events from Chat Core to persist messages in the permanent message database, ensuring durability independent of real-time delivery success. After successful persistence, it produces message stored events that conversation and notification services consume to update their local views of message state.

**Conversation Service**

Consumes conversation-related events such as member additions, member removals, and conversation metadata updates. The service maintains its own database view of conversation state and publishes events when conversations are created or modified, allowing other services to react to conversation lifecycle changes without direct coupling to the conversation database.

**Friendship Service**

Publishes events when friendship relationships change, including friend request creation, acceptance, rejection, and unfriend operations. These events allow presence and chat services to update authorization caches and adjust real-time notification delivery without polling the friendship database. The service does not consume events from other services, acting only as a producer in the event topology.

**Chat Core Service**

Consumes friendship events to maintain in-process Redis caches for authorization:
- `FriendshipBlockConsumer` (group: `nest-chat.chat-core.block-cache`): subscribes to `friendship.blocked` and `friendship.unblocked` to cache block status in Redis.
- `FriendshipFriendsConsumer` (group: `nest-chat.chat-core.friend-cache`): subscribes to `friendship.request_accepted` and `friendship.removed` to maintain a **LWW Register** (`{chat:rel:{lo}:{hi}}:friends`) via Lua CAS using broker log-append timestamp as clock. Ensures `MessageSendOrchestrator` can check friendship status from Redis (single MGET) without any TCP call to friendship-service on warm path.

**Realtime Gateway Service**

Consumes events from multiple topics to drive WebSocket message delivery to connected clients. The service subscribes to message events, presence updates, and notification events with a dedicated consumer group, ensuring all events relevant to connected users are processed for real-time delivery. The service does not produce events itself, focusing solely on consumption and WebSocket fanout.

## Design Notes

The event-driven architecture enabled by this library provides several architectural benefits while introducing complexity that teams must understand and manage effectively.

Consumer groups ensure that each event is processed by exactly one instance within a consumer group, preventing duplicate processing when services scale horizontally. However, this guarantee applies only within a single consumer group. Multiple consumer groups processing the same topic each receive every event, which is intentional for scenarios where different services need to react to the same domain events. Services must not assume exclusivity of event processing unless they coordinate consumer group assignment.

Idempotency requirements place responsibility on consuming services to handle duplicate events gracefully. Network failures, consumer rebalancing, or Kafka's at-least-once delivery semantics can result in the same event being processed multiple times. Services must implement deduplication logic using message identifiers, event identifiers, or domain-specific checks to prevent duplicate side effects. Common patterns include maintaining processed message ID sets in cache with expiration or using database unique constraints to reject duplicate state changes.

Event ordering guarantees exist only within a single partition. Kafka maintains strict ordering of messages within each partition, but messages across different partitions may be consumed in arbitrary order relative to each other. Services requiring strict ordering across multiple events must ensure related events use the same partition key, routing them to the same partition. However, total ordering across all events is generally neither possible nor necessary in distributed systems.

The publish method is asynchronous but blocks until the broker acknowledges receipt, ensuring the producer knows whether publication succeeded before returning. This approach prevents lost events when services crash immediately after attempting publication but introduces latency into the publishing path. High-throughput producers may batch multiple events or use fire-and-forget acknowledgment modes to reduce latency at the cost of potential message loss during failures.

Dead letter queue handling requires operational processes for monitoring and reprocessing failed events. Events landing in dead letter topics indicate either bugs in consumer logic, incompatible schema changes, or transient failures that exceeded retry limits. Teams must establish monitoring for dead letter topic depth and procedures for investigating failures, fixing root causes, and potentially replaying events after corrections.

Schema evolution presents challenges when event payload structures change over time. The library uses JSON serialization, which provides flexibility for adding optional fields without breaking existing consumers. However, removing fields, changing field types, or altering field semantics can break consumers reading events produced by newer publisher versions. Teams should establish schema evolution policies such as maintaining backward compatibility for specified durations or using schema registries to enforce compatibility checks.

The centralized KAFKA_TOPICS constant prevents topic name divergence but requires coordination when adding new topics. Multiple services may need simultaneous updates to import new topic constants, potentially requiring coordinated deployments. The alternative approach of allowing services to define their own topic names decentralizes control but increases risk of typos or inconsistent naming conventions preventing proper event routing.

Consumer lag monitoring is essential for operational health but not provided directly by this library. Operations teams must implement monitoring of consumer group lag using Kafka administrative tools or metrics exporters. Increasing lag indicates consumers cannot keep pace with event production, requiring investigation into consumer performance, partition count, or scaling requirements.

The event-driven architecture creates eventual consistency between services where each maintains its own view of distributed state. Services consuming events update their local databases asynchronously, meaning queries to different services may temporarily return inconsistent results after state changes. This trade-off between consistency and availability is fundamental to distributed systems, and teams must design UIs and APIs that account for eventual consistency rather than assuming immediate consistency across service boundaries.
