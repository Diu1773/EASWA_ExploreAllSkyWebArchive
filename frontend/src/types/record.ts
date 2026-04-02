export type RecordQuestionType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'number';

export interface RecordQuestionOption {
  value: string;
  label: string;
}

export interface RecordQuestion {
  id: string;
  label: string;
  type: RecordQuestionType;
  required?: boolean;
  placeholder?: string | null;
  help_text?: string | null;
  options?: RecordQuestionOption[];
  min_value?: number | null;
  max_value?: number | null;
}

export interface RecordTemplate {
  id: string;
  workflow: string;
  title: string;
  description: string;
  version: number;
  questions: RecordQuestion[];
}

export interface RecordSubmissionRequest {
  workflow: string;
  target_id: string;
  observation_ids: string[];
  title: string;
  context: Record<string, unknown>;
  answers: Record<string, unknown>;
}

export interface RecordSubmissionResponse {
  submission_id: number;
  title: string;
  created_at: string;
  export_path: string;
}

export interface RecordListItem {
  submission_id: number;
  workflow: string;
  template_id: string;
  target_id: string;
  observation_ids: string[];
  title: string;
  created_at: string;
  payload: Record<string, unknown>;
}
