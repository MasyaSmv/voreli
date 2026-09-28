export interface BackgroundJobPublisher {
  publish(
    queueName: string,
    jobName: string,
    payload: Readonly<Record<string, string>>,
    jobId: string,
  ): Promise<void>;
}

export const BACKGROUND_JOB_PUBLISHER = Symbol("BACKGROUND_JOB_PUBLISHER");
