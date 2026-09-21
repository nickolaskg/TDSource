export interface EvidenceBackedText {
  text: string;
  sourceMessageIds: string[];
}

export interface GeneratedDraft {
  title: EvidenceBackedText;
  problem: EvidenceBackedText;
  summary: EvidenceBackedText;
  steps: EvidenceBackedText[];
  warnings: EvidenceBackedText[];
  suggestedTags: string[];
  resolved: boolean;
}

export interface LlmProviderPort {
  generateGroundedDraft(input: {
    sanitizedTranscript: string;
    allowedSourceMessageIds: string[];
    promptVersion: string;
  }): Promise<GeneratedDraft>;
}

