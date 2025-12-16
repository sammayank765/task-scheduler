import Database from 'better-sqlite3';
import path from 'path';
import { Task, TaskStatus } from '../types/task';

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath: string = path.join(process.cwd(), 'tasks.db')) {
    this.db = new Database(dbPath);
    
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        dependencies TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT,
        retry_count INTEGER DEFAULT 0,
        version INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_created_at ON tasks(created_at);
    `);
  }

  insertTask(task: Task): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO tasks (
          id, type, duration_ms, dependencies, status, 
          created_at, started_at, completed_at, error, retry_count, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `);

      stmt.run(
        task.id,
        task.type,
        task.duration_ms,
        JSON.stringify(task.dependencies),
        task.status,
        task.created_at,
        task.started_at || null,
        task.completed_at || null,
        task.error || null,
        task.retry_count || 0
      );

      return true;
    } catch (error) {
      if ((error as any).code === 'SQLITE_CONSTRAINT') {
        return false; // Task already exists
      }
      throw error;
    }
  }

  getTask(taskId: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(taskId) as any;
    
    if (!row) return null;
    
    return this.rowToTask(row);
  }

  getAllTasks(): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY created_at ASC');
    const rows = stmt.all() as any[];
    
    return rows.map(row => this.rowToTask(row));
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC');
    const rows = stmt.all(status) as any[];
    
    return rows.map(row => this.rowToTask(row));
  }

  updateTaskStatus(taskId: string, newStatus: TaskStatus, currentVersion: number, updates: Partial<Task> = {}): boolean {
    const fields: string[] = ['status = ?', 'version = version + 1'];
    const values: any[] = [newStatus];

    if (updates.started_at !== undefined) {
      fields.push('started_at = ?');
      values.push(updates.started_at);
    }

    if (updates.completed_at !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completed_at);
    }

    if (updates.error !== undefined) {
      fields.push('error = ?');
      values.push(updates.error);
    }

    if (updates.retry_count !== undefined) {
      fields.push('retry_count = ?');
      values.push(updates.retry_count);
    }

    values.push(taskId, currentVersion);

    const stmt = this.db.prepare(`
      UPDATE tasks 
      SET ${fields.join(', ')}
      WHERE id = ? AND version = ?
    `);

    const result = stmt.run(...values);
    return result.changes > 0;
  }

  getReadyTasks(): Task[] {
    const tasks = this.getAllTasks();
    const completedTaskIds = new Set(
      tasks.filter(t => t.status === TaskStatus.COMPLETED).map(t => t.id)
    );

    return tasks.filter(task => {
      if (task.status !== TaskStatus.QUEUED && task.status !== TaskStatus.WAITING) {
        return false;
      }

      return task.dependencies.every(depId => completedTaskIds.has(depId));
    });
  }

  getOrphanedTasks(): Task[] {
    return this.getTasksByStatus(TaskStatus.RUNNING);
  }

  private rowToTask(row: any): Task {
    return {
      id: row.id,
      type: row.type,
      duration_ms: row.duration_ms,
      dependencies: JSON.parse(row.dependencies),
      status: row.status as TaskStatus,
      created_at: row.created_at,
      started_at: row.started_at || undefined,
      completed_at: row.completed_at || undefined,
      error: row.error || undefined,
      retry_count: row.retry_count || 0
    };
  }

  getTaskWithVersion(taskId: string): { task: Task; version: number } | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(taskId) as any;
    
    if (!row) return null;
    
    return {
      task: this.rowToTask(row),
      version: row.version
    };
  }

  close(): void {
    this.db.close();
  }

  getStats(): { total: number; queued: number; running: number; completed: number; failed: number; waiting: number } {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'WAITING' THEN 1 ELSE 0 END) as waiting
      FROM tasks
    `);
    
    const result = stmt.get() as any;
    
    return {
      total: result.total || 0,
      queued: result.queued || 0,
      running: result.running || 0,
      completed: result.completed || 0,
      failed: result.failed || 0,
      waiting: result.waiting || 0
    };
  }
}
