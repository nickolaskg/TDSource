export type WorkflowState =
  | "captured"
  | "processing"
  | "processing_failed"
  | "awaiting_review"
  | "published"
  | "rejected"
  | "archived";

export type KnowledgeLabel = "verified" | "unresolved" | "outdated" | "deprecated";

export interface KnowledgeDocumentSummary {
  id: string;
  title: string;
  summary: string;
  workflowState: WorkflowState;
  label: KnowledgeLabel;
  contentType: "sop" | "question";
  sourceSpace: string;
  teamNames: string[];
  categories: string[];
  updatedAt: string;
  transcriptVisible: boolean;
}

export interface ReviewItem {
  id: string;
  title: string;
  sourceSpace: string;
  teamName: string;
  reason: "new_capture" | "thread_update" | "change_request" | "processing_failed";
  requestedBy: string;
  requestedAt: string;
  dueAt?: string;
  organizationWide: boolean;
}
