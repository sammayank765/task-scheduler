export enum TaskStatus {
  QUEUED = 'QUEUED',       // Task is waiting to be executed
  RUNNING = 'RUNNING',     // Task is currently being executed
  COMPLETED = 'COMPLETED', // Task completed successfully
  FAILED = 'FAILED',       // Task execution failed
  WAITING = 'WAITING'      // Task is waiting for dependencies to complete
}

export interface Task {
  id: string;
  type: string;
  duration_ms: number;
  dependencies: string[];
  status: TaskStatus;
  created_at: number;
  started_at?: number;
  completed_at?: number;
  error?: string;
  retry_count?: number;
}

export interface TaskInput {
  id: string;
  type: string;
  duration_ms: number;
  dependencies?: string[];
}

export interface TaskStats {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  waiting: number;
}
