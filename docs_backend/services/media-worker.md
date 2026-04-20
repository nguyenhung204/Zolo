# Media Worker Service

## Overview

Media Worker is a background NestJS worker that consumes `media.uploaded`, performs heavy image or video processing, updates MongoDB metadata, and publishes `media.ready` or `media.failed`.

It does not expose HTTP or TCP endpoints.

---

## Architecture

The implementation uses a two-tier in-process pipeline.

### Tier 1: Kafka consumer

`MediaProcessingConsumer`:

- Consumes `media.uploaded`
- Enqueues a lightweight in-memory job
- Returns immediately so Kafka can acknowledge fast

### Tier 2: Processing queue

`ProcessingJobService`:

- In-memory `p-queue`
- Default concurrency: `MEDIA_WORKER_CONCURRENCY` or `3`
- Job timeout: `10 minutes`
- Retries: `5`
- Exponential backoff: `2s`, `4s`, `8s`, `16s`, `32s`
- Logs queue metrics every 30 seconds

There is no Redis/Bull queue. Queue state lives in memory inside the worker process.

---

## Processing Rules

### Image

`ImageProcessor` does the following:

- Read metadata with Sharp
- Auto-rotate using EXIF orientation
- Strip EXIF data
- Generate:
  - `thumb`
  - `preview`
- Formats are configurable, defaulting to WebP/JPEG output depending on env

`MediaProcessorService` then uploads variants to MinIO and stores:

- variant entries
- `thumbKey`
- image metadata (`width`, `height`, `format`)
- final status `READY`

Finally it publishes `media.ready`.

### Video

`VideoProcessor` does the following:

- Read metadata using ffprobe
- Generate a poster at `min(1 second, 10% of duration)`
- Generate MP4 variants from configured profiles
- Current built-in profiles are:
  - `mp4_720p`
  - `mp4_360p`
- FFmpeg uses thread limits from config and writes `+faststart` MP4 output

`MediaProcessorService` uploads the poster and variants, stores metadata, marks the row `READY`, then publishes `media.ready`.

### Audio and file

These are explicitly short-circuited:

- No Sharp or FFmpeg processing
- Status becomes `READY`
- No `media.ready` event is published because there is no derived media state to sync back into a message

That behavior matters for clients and for Message Store attachment sync.

---

## Failure and Recovery

### Per-job retry

When processing fails:

- Job stays in memory
- Retries up to 5 times with exponential backoff
- On final failure, job is marked failed in memory for 5 minutes
- `media.failed` is published
- MongoDB media status becomes `FAILED`

### Recovery cron

`MediaRecoveryService` runs every 5 minutes and uses Redis leader lock `media-worker:recovery:leader`.

It handles three categories:

- `PROCESSING` stuck items: re-enqueue
- `FAILED` items: re-enqueue
- `DELETION_PENDING` items: retry MinIO deletion directly and mark `DELETED` on success

So recovery is not limited to media processing. It also retries deletion cleanup.

---

## Kafka

### Consumed

- `media.uploaded`

### Produced

- `media.ready`
- `media.failed`

`media.ready` payload includes processed metadata needed by downstream attachment sync:

- `mediaId`
- `ownerId`
- `type`
- `thumbKey`
- `variants`
- `meta`

`media.failed` includes:

- `mediaId`
- `ownerId`
- `error`

---

## Resource Control

The worker explicitly tries to avoid CPU thrash:

- queue concurrency is capped
- FFmpeg thread count is capped (`FFMPEG_THREADS`, default `2`)
- FFmpeg nice level is configurable (`FFMPEG_NICE_LEVEL`, default `10`)

The design intent is:

- Kafka ack quickly
- run CPU-heavy work only inside the bounded queue
- let multiple worker replicas scale horizontally by sharing the same Kafka group

---

## Boundaries

Media Worker does not:

- issue access URLs
- authorize media access
- expose APIs to clients
- persist upload sessions
- notify WebSocket clients directly

Downstream flow after success or failure is:

- Media Worker publishes `media.ready` / `media.failed`
- Message Store updates the related attachment
- Realtime Gateway emits `message:media_ready` when relevant
