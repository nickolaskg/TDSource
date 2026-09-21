export interface CaptureIdentity {
  provider: string;
  spaceProviderId: string;
  rootMessageProviderId: string;
  command: "document" | "update";
}

export interface CaptureRepositoryPort {
  beginCapture(identity: CaptureIdentity, requestedByUserId: string): Promise<{ id: string; created: boolean }>;
  storeImmutableSourceSnapshot(captureId: string, snapshot: unknown): Promise<void>;
  markProcessingFailed(captureId: string, safeErrorCode: string): Promise<void>;
}

