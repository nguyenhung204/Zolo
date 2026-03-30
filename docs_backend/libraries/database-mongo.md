# Database MongoDB Library

## Purpose

The database-mongo library provides a Mongoose-based abstraction layer for MongoDB document storage, offering a complementary persistence option to the PostgreSQL-based relational storage used throughout the system. This library was designed to support use cases requiring flexible schema design, high write throughput, or document-oriented data models that map poorly to relational structures.

This library is actively used by the `media-service` and `media-worker` for storing and querying media metadata. It maintains parity with the database-postgres abstraction patterns, ensuring consistent developer experience when working with either database technology.

## Exported Modules

**DatabaseMongoModule**

The primary module establishing Mongoose connections to MongoDB instances using NestJS dependency injection patterns. It provides configuration methods matching the PostgreSQL module's API surface, supporting both synchronous and asynchronous initialization patterns. The module handles connection pooling, schema registration, and connection lifecycle management automatically.

The module supports multiple simultaneous connections to different MongoDB databases when services need to partition data across clusters or separate operational databases from analytical databases. Connection configuration includes replica set support for high availability deployments and read preference settings for workload-specific tuning.

**AbstractMongoRepository**

An abstract base class implementing common document operations for any schema type through TypeScript generics. The repository provides methods analogous to the PostgreSQL repository while accommodating MongoDB's document-oriented nature:

- findById: Retrieves a document by ObjectId with optional population of referenced documents
- findAll: Returns documents matching filter criteria with MongoDB's flexible query syntax
- create: Persists a new document with automatic timestamp and default value population
- update: Modifies documents using MongoDB update operators for atomic updates
- delete: Soft or hard deletes documents based on configuration
- exists: Checks for document existence using efficient indexed queries

Services extending this repository gain access to MongoDB-specific capabilities such as aggregation pipeline operations, text search, and geospatial queries while maintaining consistent method signatures with the PostgreSQL repository.

**AbstractSchema**

A base schema definition that all MongoDB schemas extend, providing common fields and behavior:

- timestamps: Automatic createdAt and updatedAt timestamp management through Mongoose plugins
- Document transformation: JSON serialization configuration for consistent API responses
- Index hints: Base schema configuration for common index patterns

Unlike the PostgreSQL BaseEntity which uses UUIDs, MongoDB schemas rely on ObjectId generation for primary keys, following MongoDB's native identifier pattern. The AbstractSchema ensures timestamp tracking matches the behavior of PostgreSQL entities despite the different underlying implementation.

## Configuration

MongoDB connections require the following environment variables:

- MONGO_HOST: MongoDB server hostname or connection string
- MONGO_PORT: Database server port, defaulting to 27017
- MONGO_USERNAME: Authentication username for database access
- MONGO_PASSWORD: Authentication password for secure connections
- MONGO_DATABASE: Specific database name for the microservice
- MONGO_AUTH_SOURCE: Authentication database, typically admin or the service database

Connection strings support MongoDB's full URL syntax including replica set configuration, SSL settings, and connection options. For clustered deployments, the connection string specifies multiple host-port combinations and replica set names to enable automatic failover and read distribution.

The library does not expose a synchronize-equivalent flag because MongoDB's schemaless nature makes automatic schema synchronization unnecessary. Schema validation rules defined in Mongoose schemas apply at the application layer rather than the database layer, though MongoDB 3.6 and later support optional JSON schema validation at the collection level.

## Services Using This Library

Two microservices use this library for production data persistence:

**media-service**: Uses `DatabaseMongoModule.forRootAsync` to connect to the `media-mongodb` container. Stores `MediaObject` documents (tracking the upload state machine: CREATED/UPLOADED/PROCESSING/READY/DELETED/FAILED), `MediaBinding` documents (links media to messages and conversations), and `UploadSession` documents (tracks active pre-signed upload sessions with expiry).

**media-worker**: Uses `DatabaseMongoModule.forRootAsync` to connect to the same `media-mongodb` container. Reads and updates `MediaObject` documents during background processing (image resize via Sharp, video transcoding via FFmpeg). Updates processing status and stores variant URLs after successful processing.

## Design Notes

The strategic decision to include MongoDB infrastructure before immediate need reflects several architectural considerations.

Adding database technology to an existing system after it is already in production introduces significant operational complexity. Teams must establish new deployment pipelines, monitoring infrastructure, backup procedures, and operational expertise. By including MongoDB infrastructure during initial system development, the codebase remains prepared for document-oriented requirements without the friction of introducing new technology stacks mid-project.

However, this approach carries the risk of technology sprawl where multiple databases increase operational overhead without commensurate benefits. The system must guard against using MongoDB simply because it exists rather than because it provides genuine advantages over PostgreSQL for specific use cases. Each adoption decision should include explicit justification documenting why document storage outweighs the complexity of maintaining multiple database technologies.

The repository abstraction maintains parallel interfaces between PostgreSQL and MongoDB repositories, enabling services to switch persistence layers without rewriting business logic. This flexibility proves valuable when prototyping or when initial technology choices prove suboptimal. However, the abstraction cannot completely hide differences between relational and document-oriented storage, particularly around transaction semantics, query capabilities, and consistency models.

MongoDB's transaction support has improved significantly since version 4.0, providing multi-document ACID transactions within replica sets and sharded clusters. However, MongoDB transactions carry different performance characteristics and limitations compared to PostgreSQL transactions. Services requiring complex transactional workflows across multiple documents should carefully evaluate whether MongoDB's transaction model meets their consistency requirements.

The AbstractSchema's reliance on Mongoose schemas for validation places data integrity enforcement at the application layer rather than the database layer. This approach provides flexibility and rapid iteration during development but requires careful testing to ensure invalid data cannot enter the database through direct database access, compromised service instances, or bugs bypassing validation logic. Services handling sensitive or critical data should evaluate whether MongoDB's optional schema validation provides sufficient protection for their requirements.

Document embedding versus referencing presents design decisions without clear equivalents in relational modeling. The MongoDB repository abstraction does not prescribe patterns for modeling relationships, leaving services to determine appropriate strategies based on access patterns, data size, and update frequencies. Services should prefer embedding related data within documents when read together frequently and data size remains manageable, while using references for large or independently updated subdocuments.

The MongoDB infrastructure is production-active via media-service and media-worker. The document model suits media metadata well: schema flexibility accommodates varying media types (image, video, audio, file, document), and the document structure naturally represents processing variant URLs and metadata without complex relational joins.
