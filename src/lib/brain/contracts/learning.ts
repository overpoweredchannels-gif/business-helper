export interface LearningInput {
  requestId: string;
  question: string;
  detectedLanguage: string;
  intent: string;
  skillsInvoked: string[];
  pipelineMode: "read" | "write";
  confirmationDecision: string | null;
  executionSuccess: boolean | null;
  responseRendered: boolean;
  followUpQuestions: number;
  timestamp: string;
}

export interface LearningResult {
  preferencesUpdated: PreferenceUpdate[];
  suggestedQuestionsUpdated: boolean;
  updatedSuggestedQuestions: string[];
  memoryRefreshTriggered: boolean;
  memorySectionsToRefresh: string[];
  durationMs: number;
  warnings: string[];
}

export interface PreferenceUpdate {
  key: string;
  previousValue: unknown;
  newValue: unknown;
  method: "implicit" | "explicit";
  confidence: number;
}
