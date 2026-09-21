export interface NormalizedMessage {
  providerMessageId: string;
  parentProviderMessageId: string | null;
  authorProviderId: string;
  authorDisplayName: string;
  createdAt: string;
  markdown: string;
  attachmentProviderIds: string[];
}

export interface NormalizedThread {
  provider: string;
  spaceProviderId: string;
  rootProviderMessageId: string;
  messages: NormalizedMessage[];
  capturedAt: string;
}

export interface ChatProviderPort {
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<boolean>;
  fetchCompleteThread(spaceId: string, rootMessageId: string): Promise<NormalizedThread>;
  postAcknowledgement(spaceId: string, parentMessageId: string, message: string): Promise<void>;
}

