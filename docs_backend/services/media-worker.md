# Media Worker Service

**Port**: N/A (Background worker, no HTTP/TCP server)  
**Technology**: NestJS + p-queue + FFmpeg + Sharp  
**Database**: MongoDB (shared with Media Service for media metadata)  
**Storage**: MinIO (shared with Media Service)

---

##  Purpose

Background worker that processes uploaded media (images, videos) asynchronously to generate optimized variants for different use cases.

---

##  Architecture

### Pattern: **2-Tier Processing**

```

 Tier 1: Kafka Consumer (Fast Ack)                          
 - Receives MEDIA.UPLOADED events                           
 - Enqueues job to in-memory queue → Returns immediately    
 - Keeps consumer alive, no rebalancing issues              

                       
                        In-Memory Job Queue (p-queue)
                       

 Tier 2: Job Processor (Heavy Processing)                   
 - Processes jobs with controlled concurrency (default: 3)  
 - CPU-intensive: FFmpeg, Sharp, video encoding              
 - Retry mechanism with exponential backoff                  
 - Job status tracking (pending/processing/completed/failed) 

```

**Why 2-Tier?**
-  Prevents Kafka rebalancing from blocking heavy CPU work
-  Controlled resource usage (e.g., 3 concurrent jobs on 8-core machine)
-  Better observability (queue metrics, job status tracking)
-  No external dependencies (no Redis/Bull needed)

---

##  Processing Workflow

### Image Processing
1. **Idempotency Check**: Skip if media status is `READY`
2. **Update Status**: Set to `PROCESSING` in MongoDB
3. **Download** original from MinIO
4. **Normalize**: Auto-rotate based on EXIF, strip sensitive data
5. **Generate variants**:
   - `thumb`: 320px, WebP 70% quality → Set as thumbnailUrl
   - `preview`: 1280px, WebP 75% quality
6. **Upload** variants to MinIO
7. **Update** MongoDB: `status=READY`, variants array, thumbnailUrl, metadata (width/height/format)
8. **Publish** `media.ready` event to Kafka

### Video Processing
1. **Idempotency Check**: Skip if media status is `READY`
2. **Update Status**: Set to `PROCESSING` in MongoDB
3. **Download** original from MinIO
4. **Extract metadata** via FFmpeg (duration, bitrate, codec)
5. **Generate variants**:
   - `poster`: First frame as JPEG thumbnail → Set as thumbnailUrl
   - Video variants based on configured profiles
6. **Upload** all variants to MinIO
7. **Update** MongoDB: `status=READY`, variants array, thumbnailUrl, metadata
8. **Publish** `media.ready` event to Kafka

### File Processing
- **No processing needed**: Just log and skip (status remains as-is)

---

##  Retry Logic

- **Max Retries**: 5 (increased from 3 for better resilience)
- **Backoff Strategy**: Exponential (2^attempt * 1000ms)
  - Attempt 1: 2s delay
  - Attempt 2: 4s delay
  - Attempt 3: 8s delay
  - Attempt 4: 16s delay
  - Attempt 5: 32s delay
- **Timeout**: 10 minutes per job (600,000ms)
- **Dead Letter**: 
  - Failed jobs kept for 5 minutes (300s) for monitoring/manual retry
  - Completed jobs kept for 1 minute (60s) for debugging
  - Callback `onJobExhausted` for DLQ handling

---

##  Consumed Kafka Topics

| Topic | Description | Handler | Event Format |
|-------|-------------|---------|--------------|
| `media.uploaded` | Media upload notification | `MediaProcessingConsumer.handleMediaUploaded` | `{ mediaId, ownerId, type, mimeType, originalKey }` |

---

##  Produced Kafka Topics

| Topic | Description | Payload | Kafka Key |
|-------|-------------|---------|-----------|
| `media.ready` | Media processing completed | `{ mediaId, ownerId, type, variants, thumbnailUrl, metadata }` | `user:{ownerId}` |
| `media.failed` | Media processing failed | `{ mediaId, ownerId, error, attempts }` | `user:{ownerId}` |

---

##  MongoDB Collections

- **media_objects**: Shared collection with Media Service
  - **Read**: `findById` for idempotency check
  - **Write**: 
    - `updateStatus(mediaId, 'PROCESSING')` at start
    - `updateMetadata(mediaId, { variants, thumbnailUrl, meta, status: 'READY' })` on success

---

##  Configuration (Environment Variables)

```bash
# Kafka
KAFKA_CLIENT_ID=nest-api-system
KAFKA_BROKERS=localhost:9092
MEDIA_WORKER_KAFKA_GROUP_ID=media-worker-group

# MongoDB
MEDIA_MONGODB_URI=mongodb://localhost:27017/media_db

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false
MINIO_BUCKET_NAME=media-storage

# Concurrency Control (default: 3)
# Rule: For 8 vCPU machine, set concurrency=3 → Each job gets ~2-3 threads
MEDIA_WORKER_CONCURRENCY=3

# Image Processing (defaults)
IMAGE_THUMB_MAX_SIZE=320
IMAGE_THUMB_QUALITY=70
IMAGE_THUMB_FORMAT=webp
IMAGE_PREVIEW_MAX_SIZE=1280
IMAGE_PREVIEW_QUALITY=75
IMAGE_PREVIEW_FORMAT=webp
```

---

##  Deployment Notes

- **Not in docker-compose**: This service has a Dockerfile (`apps/media-worker/Dockerfile`) but is not included in the current `docker-compose.yml`. Run it separately via `pnpm start:media-worker:dev` or build the Docker image manually.
- **Resource Requirements**: 8 vCPU recommended (3 concurrent jobs = ~2.6 threads each)
- **Scaling**: Run multiple instances with same `MEDIA_WORKER_KAFKA_GROUP_ID` for horizontal scaling (Kafka auto-balances partitions)
- **Monitoring**: Logs queue metrics every 30s:
  ```json
  { "pending": 2, "size": 15, "isPaused": false, "totalJobs": 17 }
  ```
- **Recovery**: `RecoveryService` scheduled to retry stuck jobs

---

##  Performance Metrics

- **Image Processing**: ~500ms for 2 variants (thumb + preview)
- **Video Processing**: ~5-60s depending on original resolution and duration
- **Throughput**: 
  - 3 concurrent jobs can process ~180 images/minute
  - ~10 videos/minute (1080p source)

---

##  Security Considerations

- **EXIF Stripping**: Sensitive GPS/camera data removed from images (only basic orientation kept)
- **File Validation**: Sharp metadata check for images
- **Buffer Limits**: Entire file loaded into memory (consider streaming for very large videos)

---

##  Module Structure

```typescript
@Module({
  imports: [
    SharedConfigModule,
    ScheduleModule.forRoot(),
    KafkaModule,
    DatabaseMongoModule,
    MinioModule,
  ],
  providers: [
    // Tier 1: Lightweight consumer
    MediaProcessingConsumer,
    
    // Tier 2: Heavy processing with concurrency control
    ProcessingJobService,    // In-memory job queue (p-queue)
    MediaProcessorService,   // Actual processing logic
    
    // Recovery for stuck/failed media
    RecoveryService,
    
    // Format-specific processors
    ImageProcessor,          // Sharp-based image processing
    VideoProcessor,          // FFmpeg-based video processing
    
    // Repository
    MediaRepository,
  ],
})
export class MediaWorkerModule {}
```

---

##  Code References

### Core Services
- Consumer: [MediaProcessingConsumer](../../apps/media-worker/src/consumers/media-processing.consumer.ts)
- Job Queue: [ProcessingJobService](../../apps/media-worker/src/services/processing-job.service.ts)
- Processor: [MediaProcessorService](../../apps/media-worker/src/services/media-processor.service.ts)
- Image Processor: [ImageProcessor](../../apps/media-worker/src/processors/image.processor.ts)
- Video Processor: [VideoProcessor](../../apps/media-worker/src/processors/video.processor.ts)
- Repository: [MediaRepository](../../apps/media-worker/src/repositories/media.repository.ts)

### Key Implementation Details

**Tier 1 Consumer (Fast Ack)**:
```typescript
@KafkaHandler({ topic: KAFKA_TOPICS.MEDIA.UPLOADED })
async handleMediaUploaded(event: MediaUploadedEvent) {
  // Enqueue job → Return fast (< 10ms)
  await this.processingJobService.enqueue({
    id: event.mediaId,
    type: event.type,
    data: event,
  });
  // Consumer acks immediately, Kafka stays healthy
}
```

**Tier 2 Processor (Controlled Concurrency)**:
```typescript
constructor() {
  const concurrency = parseInt(process.env.MEDIA_WORKER_CONCURRENCY || '3', 10);
  this.queue = new PQueue({ concurrency, timeout: 600000 });
}

// Retry with exponential backoff
if (job.attempts < this.maxRetries) {
  const delay = Math.pow(2, job.attempts) * 1000; // 2s, 4s, 8s...
  setTimeout(() => this.queue.add(() => processJob(job)), delay);
}
```

**Idempotency Check**:
```typescript
async processMediaJob(job: ProcessingJob) {
  const media = await this.mediaRepository.findById(event.mediaId);
  if (media.status === MediaStatus.READY) {
    this.logger.log(`Already processed, skipping`);
    return; // Idempotent
  }
  // ... proceed with processing
}
```
