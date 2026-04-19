# Kafka Library

## Purpose

The kafka library provides a comprehensive abstraction layer for Apache Kafka integration, enabling event-driven communication patterns across microservices. It standardizes event production, consumption, error handling, and retry logic while hiding the complexity of Kafka client configuration and consumer group management. The library enables services to implement asynchronous communication patterns that decouple producers from consumers, allowing independent scaling and deployment of event publishers and subscribers.

This event-driven architecture supports several critical system capabilities including eventual consistency across service boundaries, asynchronous processing of non-critical operations, and audit trails of all significant state changes. Services publish domain events when state changes occur and consume events from other services to maintain localized views of distributed data without direct database coupling.

## Exported Modules

**KafkaModule**

The root module that establishes Kafka client connections and registers producers and consumers within the NestJS dependency injection container. It supports configuration through environment variables or programmatic initialization, handling connection lifecycle including graceful shutdown when services terminate. The module automatically discovers and registers consumer classes decorated with Kafka-specific decorators during application bootstrap.

**KafkaClient**

A low-level client wrapper providing direct access to Kafka administrative operations such as topic creation, partition management, and cluster metadata retrieval. Most services do not interact directly with KafkaClient, instead using higher-level producer and consumer abstractions. However, initialization scripts and operational tooling use this client for administrative tasks.

**KafkaProducer**

The primary interface for publishing events to Kafka topics. The producer provides a publish method accepting a topic name and event payload, handling serialization, partition assignment, and delivery confirmation automatically. Key capabilities include:

Automatic serialization: Event objects are serialized to JSON before transmission, with support for custom serializers when binary formats or schema registries are required.

Partition key support: Events can specify partition keys to ensure related events route to the same partition, maintaining ordering guarantees for events about the same entity.

Retry logic: Transient failures during event publication trigger automatic retries with exponential backoff, ensuring reliable delivery without manual retry implementation in service code.

Delivery confirmation: The producer waits for broker acknowledgment before considering events published, configurable between fire-and-forget, leader acknowledgment, or full replica acknowledgment based on durability requirements.

The producer is injected as a singleton service, maintaining a persistent connection to Kafka brokers and reusing it across all event publications within a service instance.

**AbstractKafkaConsumer**

An abstract base class that services extend to implement event consumers. The class provides infrastructure for consuming events from one or more topics with the following capabilities:

Message deserialization: Incoming messages are automatically deserialized from JSON to typed event objects based on TypeScript interfaces.

Error handling: Exceptions thrown during message processing are caught and logged, with configurable behavior for whether to commit offsets for failed messages or retry processing.

Dead letter queue support: Messages that fail processing after exhausting retry attempts are automatically routed to dead letter topics for manual investigation or later reprocessing.

Graceful shutdown: Consumers properly disconnect from consumer groups during service shutdown, allowing remaining instances to rebalance partitions.

Services implementing consumers override the onMessage method to define business logic for processing each event type. The abstract consumer handles all Kafka protocol concerns, allowing service logic to focus on event interpretation and state updates.

**KafkaConsumerRegistryService**

The internal registry that manages Kafka consumer lifecycle for all `@KafkaHandler`-decorated methods. Key behaviors:

- **Auto-restart on crash**: If `consumer.run()` throws (e.g., broker disconnect, network drop), the registry logs the error and automatically restarts the consumer after a 5-second delay. The consumer is only restarted while it is still tracked (tracked = not destroyed by `onModuleDestroy`).
- **Retryable error detection**: Expanded set of retryable errors during initial subscription: `LEADER_NOT_AVAILABLE`, `UNKNOWN_TOPIC_OR_PARTITION`, `ECONNREFUSED`, `Connection timeout`, `KafkaJSNonRetriableError`, and `topic-partition` messages. Retries with linear backoff (2s, 4s, 6s, 8s, 10s) up to 5 attempts before giving up.
- **Concurrency**: Default `partitionsConsumedConcurrently: 1` per consumer group to prevent CPU/RAM overload. Scale horizontally instead.

**KafkaHandler Decorator**

A method-level decorator that binds consumer methods to specific topic and consumer group combinations. The decorator enables multiple consumer methods within a single service to subscribe to different topics or the same topic with different consumer groups for parallel processing patterns. Configuration includes topic name, consumer group identifier, and optional `fromBeginning` flag.

**KAFKA_TOPICS Constant**

A centralized registry of all topic names used throughout the system. Services import topic constants rather than using string literals, enabling compile-time validation of topic references.

**DLQ Topics**

Three dedicated Dead Letter Queue topics (all with 30-day retention, 4 partitions):
- `chat.dlq` - General DLQ
- `chat.dlq.commands` - DLQ for command events (request/reply patterns)
- `chat.dlq.events` - DLQ for domain events (fire-and-forget patterns)

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
