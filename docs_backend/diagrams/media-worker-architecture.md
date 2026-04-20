# Media Worker Architecture

## Overview

The Media Worker implementation is a two-tier pipeline:

1. Kafka consumer tier for fast acknowledgement
2. In-memory bounded processing tier for CPU-heavy image/video work

It is intentionally not a REST service and not a Redis/Bull queue worker.

---

## Flow Diagram

```mermaid
flowchart TD
    A[Media Service publishes media.uploaded] --> B[MediaProcessingConsumer]
    B --> C[ProcessingJobService enqueue]
    C --> D[PQueue bounded concurrency]
    D --> E[MediaProcessorService]

    E --> F{Media type}
    F -->|image| G[ImageProcessor Sharp]
    F -->|video| H[VideoProcessor FFmpeg]
    F -->|audio/file| I[Mark READY without derived assets]

    G --> J[Upload thumb + preview to MinIO]
    H --> K[Upload poster + MP4 variants to MinIO]
    I --> L[Update MongoDB status READY]

    J --> M[Update MongoDB metadata]
    K --> M
    M --> N[Publish media.ready]
    L --> O[No media.ready event]

    E -->|failure| P[Update MongoDB status FAILED]
    P --> Q[Publish media.failed]
```

---

## Queue and Retry Model

```mermaid
flowchart LR
    A[Kafka event] --> B[In-memory job record]
    B --> C[PQueue worker slot]
    C --> D{Success?}
    D -->|yes| E[completed]
    D -->|no and attempts < 5| F[retry with exponential backoff]
    F --> C
    D -->|no and attempts = 5| G[failed in memory for 5 minutes]
```

Actual retry timings from code:

- attempt 1 retry: 2s
- attempt 2 retry: 4s
- attempt 3 retry: 8s
- attempt 4 retry: 16s
- attempt 5 retry: 32s

Job timeout is 10 minutes.

---

## Recovery Pass

A separate cron-driven recovery path runs every 5 minutes with a Redis leader lock.

```mermaid
flowchart TD
    A[MediaRecoveryService cron] --> B[Find stuck media rows]
    B --> C{Status}
    C -->|PROCESSING or FAILED| D[Re-enqueue processing job]
    C -->|DELETION_PENDING| E[Retry MinIO delete]
    E -->|success| F[Mark DELETED]
    E -->|failure| G[Leave DELETION_PENDING for next pass]
```

---

## Type-Specific Behavior

### Image

- Normalize orientation
- Strip EXIF
- Generate `thumb` and `preview`
- Publish `media.ready`

### Video

- Extract metadata with ffprobe
- Generate poster at `min(1 second, 10% of duration)`
- Generate built-in MP4 variants: `mp4_720p`, `mp4_360p`
- Publish `media.ready`

### Audio and file

- No heavy processing
- Mark `READY`
- Do not publish `media.ready`

That last point is important: attachment refresh events are only produced for media that actually generated new derived assets.
