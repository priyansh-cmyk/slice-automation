export interface VideoGenerationProvider {
  uploadReferenceImage(params: {
    imagePath: string;
    contentType: string;
    email: string;
  }): Promise<{ mediaGenerationId: string }>;

  submitGeneration(params: {
    prompt: string;
    model: string;
    referenceImageMediaId: string;  // sent as referenceImage_1 (R2V mode)
    duration: number;               // 4/6/8/10 for omni-flash; 8 only for Veo R2V
    aspectRatio: string;
    seed?: number;
    correlationId: string;
  }): Promise<{ jobId: string; videoUrl?: string; mediaGenerationId?: string }>;

  pollJob(jobId: string): Promise<{
    status: 'created' | 'started' | 'completed' | 'failed';
    videoUrl?: string;
    outputMediaGenerationId?: string;
    remainingCredits?: number;
    errorMessage?: string;
    errorCode?: string;
    retryAfterMs?: number;
  }>;

  // Provider selects URL (signed or raw), handles auth, streams to a temp file under STORAGE_DIR.
  // Caller owns tempPath on return and is responsible for cleanup on any subsequent failure.
  downloadVideo(params: {
    jobId: string;
    signedUrl: string | null;
    outputMediaGenerationId: string | null;
    jobCompletedAt: number;
  }): Promise<{ tempPath: string; contentType: string }>;
}
