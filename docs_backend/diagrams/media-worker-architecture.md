# Media Worker Architecture Diagram

## 2-Tier Processing Pipeline

```

                    KAFKA: media.uploaded Topic                          
                    Message: { mediaId, ownerId, type, ... }             

                                     
                                     

                TIER 1: MediaProcessingConsumer                          
                (Lightweight - Fast Kafka Ack)                           

  @KafkaHandler(MEDIA.UPLOADED)                                          
  async handleMediaUploaded(event) {                                     
    await jobService.enqueue({ id, type, data });  // <100ms             
    return; // Kafka acks immediately                                    
  }                                                                       
                                                                          
   No CPU work here                                                     
   No rebalance risk                                                    
   Consumer stays healthy                                               

                                     
                                     
                         
                            Job Queue (Memory)  
                            p-queue library     
                            Max: 3 concurrent   
                         
                                     
                                     

              TIER 2: ProcessingJobService                               
              (Concurrency Controller)                                    

  const queue = new PQueue({                                             
    concurrency: 3,        // Max 3 jobs parallel                        
    timeout: 600000        // 10 min per job                             
  });                                                                     
                                                                          
  Responsibilities:                                                       
  - Limit concurrent jobs (e.g., 3 max)                                  
  - Retry failed jobs (exponential backoff)                              
  - Track status (pending/processing/completed/failed)                   
  - Emit metrics every 30s                                               

                                     
                    
                                                    
                                                    
                      
             Job 1          Job 2          Job 3    
             (active)       (active)       (active) 
                      
                                                 
                                                 

              MediaProcessorService                                       
              (Heavy CPU Processor)                                       

  async processMediaJob(job: ProcessingJob) {                            
    1. Idempotency check (DB)                                            
    2. Download from MinIO                                               
    3. Process media (image/video)                                       
    4. Upload variants to MinIO                                          
    5. Update DB metadata                                                
    6. Publish Kafka events (media.ready/failed)                         
  }                                                                       

                                     
                    
                                                     
                      
         ImageProcessor                  VideoProcessor   
         (Sharp library)                 (ffmpeg spawn)   
                      
         - Resize                        - Transcode      
         - WebP/JPEG                     - Poster extract 
         - Thumbnails                    - H.264 encode   
                      
                                                    
                                                    
                                        
                                         FFmpeg Child Process 
                                        
                                         -threads 2           
                                         -nice 10             
                                         -preset veryfast     
                                         -crf 23              
                                                              
                                         CPU Work Here!       
                                         (Not Node.js)        
                                        
```

## CPU Resource Management

```

                   8 vCPU Machine                                

                                                                 
                                 
   Job 1     Job 2     Job 3                             
   (2 CPU)   (2 CPU)   (2 CPU)  <-- Controlled          
                                 
                                                                 
  Total: 6 CPUs used / 8 available   Healthy                  
                                                                 
  Formula:                                                       
    Concurrency = 3                                             
    Threads per job = 8 / 3 ≈ 2                                
    Total threads = 3 × 2 = 6   Fits comfortably              
                                                                 


WITHOUT Thread Limiting ( BAD):


                   8 vCPU Machine                                

                                                                 
                                 
   Job 1     Job 2     Job 3                             
   (8 CPU)   (8 CPU)   (8 CPU)  <-- Uncontrolled!       
                                 
                                                                 
  Total: 24 threads competing for 8 cores!                      
  Result: CPU thrashing, context switching, slower throughput   
                                                                 

```

## Data Flow

```

 Client Upload
 (via Gateway)

       
       

 Media Service (HTTP) 
 POST /media/upload   

           
           
    
       MinIO     
     (S3 Storage)
    
          
          

 Media Service           
 POST /upload/complete   
 - Verify checksum       
 - Update DB: UPLOADED   

          
          
    
       Kafka     
    media.uploaded
    
          
          

 Media Worker (Consumer) 
 Enqueue job             

          
          
    
      Job Queue   
      (p-queue)   
    
          
          

 ProcessorService        
 - Download from MinIO   
 - Process with ffmpeg   
 - Upload variants       
 - Update DB: READY      

          
          
    
       Kafka     
     media.ready 
    
          
          

 Realtime Gateway (WS)   
 Notify clients          

```

## Job Status Lifecycle

```

 PENDING   ← Job enqueued

     
       ProcessingJobService polls
     

 PROCESSING   ← Job picked up by p-queue

     
      Success  
                              COMPLETED 
                             
     
      Failure  Retry?
                                   
                        
                                             
                   Attempts < 3          Attempts = 3
                                             
                                             
                             
                   PENDING             FAILED 
                   (retry)            
                  
                  Wait: 2^attempts seconds
                  (2s, 4s, 8s)
```

## Monitoring Dashboard (Example)

```

             Media Worker Dashboard                          

                                                              
  Queue Metrics:                                             
    Concurrency Limit: 3                                     
    Currently Processing: 3                                  
    Waiting in Queue: 5                                      
    Paused: false                                            
                                                              
  Job Statistics:                                            
    Pending:    5                         
    Processing: 3                         
    Completed: 42         
    Failed:     1                         
                                                              
  System Resources:                                          
    CPU Usage: 67%                  
    Memory:    2.1 GB / 8 GB                                 
                                                              
  Recent Jobs:                                               
    [12:34:56] video-abc123 → COMPLETED (45s)               
    [12:35:12] image-def456 → COMPLETED (2s)                
    [12:35:30] video-ghi789 → PROCESSING (12s elapsed)      
                                                              

```

## Configuration Matrix

| Scenario | vCPU | Concurrency | Threads/Job | Preset | Use Case |
|----------|------|-------------|-------------|--------|----------|
| Dev | 4 | 2 | 2 | ultrafast | Local testing |
| Prod Small | 8 | 3 | 2 | veryfast | Standard deployment |
| Prod Large | 16 | 5 | 3 | fast | High throughput |
| High Quality | 8 | 2 | 4 | medium | Quality over speed |

## Key Takeaways

1. **Separation of Concerns**: Consumer fast → Processor heavy
2. **Concurrency Control**: p-queue limits parallel jobs
3. **Thread Limiting**: ffmpeg -threads prevents CPU thrashing
4. **Node.js Role**: Orchestrator (spawn ffmpeg, not run encoding)
5. **Production Ready**: Tunable for 4-16 vCPU machines

---

**Formula to Remember**:
```
threads_per_job = total_vCPU / concurrency

Example (8 vCPU):
  concurrency = 3
  threads_per_job = 8 / 3 ≈ 2-3
  total_threads = 3 × 2 = 6 (healthy!)
```
