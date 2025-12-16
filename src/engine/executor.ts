import { Task, TaskStatus } from '../types/task';
import { DatabaseManager } from '../storage/database';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export class TaskExecutor extends EventEmitter {
  private db: DatabaseManager;
  private maxConcurrentTasks: number;
  private runningTasks: Set<string>;
  private isRunning: boolean;
  private schedulerInterval: NodeJS.Timeout | null;

  constructor(db: DatabaseManager, maxConcurrentTasks: number = 3) {
    super();
    this.db = db;
    this.maxConcurrentTasks = maxConcurrentTasks;
    this.runningTasks = new Set();
    this.isRunning = false;
    this.schedulerInterval = null;
  }

  start(): void {
    if (this.isRunning) {
      logger.warn('Executor is already running');
      return;
    }

    this.isRunning = true;
    logger.info(`Task Executor started with max concurrency: ${this.maxConcurrentTasks}`);

    this.recoverOrphanedTasks();

    this.schedulerInterval = setInterval(() => {
      this.scheduleNextTasks();
    }, 100);

    this.scheduleNextTasks();
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    logger.info('Task Executor stopped');
  }

  private recoverOrphanedTasks(): void {
    const orphanedTasks = this.db.getOrphanedTasks();
    
    if (orphanedTasks.length > 0) {
      logger.warn(`Found ${orphanedTasks.length} orphaned task(s). Resetting to QUEUED...`, {
        orphanedTaskIds: orphanedTasks.map(t => t.id)
      });
      
      for (const task of orphanedTasks) {
        const taskWithVersion = this.db.getTaskWithVersion(task.id);
        if (taskWithVersion) {
          this.db.updateTaskStatus(
            task.id,
            TaskStatus.QUEUED,
            taskWithVersion.version,
            {
              started_at: undefined,
              error: 'Task was interrupted by system restart'
            }
          );
        }
      }
    }
  }

  private scheduleNextTasks(): void {
    if (!this.isRunning) {
      return;
    }

    const availableSlots = this.maxConcurrentTasks - this.runningTasks.size;
    
    if (availableSlots <= 0) {
      return; // No slots available
    }

    const readyTasks = this.db.getReadyTasks();
    
    if (readyTasks.length === 0) {
      return; // No tasks ready to run
    }

    readyTasks.sort((a, b) => a.created_at - b.created_at);

    const tasksToExecute = readyTasks.slice(0, availableSlots);

    for (const task of tasksToExecute) {
      this.executeTask(task);
    }
  }

  private async executeTask(task: Task): Promise<void> {
    const taskWithVersion = this.db.getTaskWithVersion(task.id);
    
    if (!taskWithVersion) {
      logger.warn(`Task ${task.id} not found`, { taskId: task.id });
      return;
    }

    const { version } = taskWithVersion;

    const claimed = this.db.updateTaskStatus(
      task.id,
      TaskStatus.RUNNING,
      version,
      {
        started_at: Date.now()
      }
    );

    if (!claimed) {
      logger.debug(`Task ${task.id} was already claimed by another worker`, { taskId: task.id });
      return;
    }

    this.runningTasks.add(task.id);
    logger.info(`Task ${task.id} started execution (${task.duration_ms}ms)`, {
      taskId: task.id,
      duration: task.duration_ms,
      type: task.type
    });

    try {
      await this.sleep(task.duration_ms);

      const finalTaskWithVersion = this.db.getTaskWithVersion(task.id);
      
      if (finalTaskWithVersion) {
        this.db.updateTaskStatus(
          task.id,
          TaskStatus.COMPLETED,
          finalTaskWithVersion.version,
          {
            completed_at: Date.now()
          }
        );
      }

      logger.info(`Task ${task.id} completed successfully`, {
        taskId: task.id,
        duration: task.duration_ms,
        type: task.type
      });
      this.emit('task:completed', task.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const finalTaskWithVersion = this.db.getTaskWithVersion(task.id);
      
      if (finalTaskWithVersion) {
        this.db.updateTaskStatus(
          task.id,
          TaskStatus.FAILED,
          finalTaskWithVersion.version,
          {
            completed_at: Date.now(),
            error: errorMessage
          }
        );
      }

      logger.error(`Task ${task.id} failed: ${errorMessage}`, {
        taskId: task.id,
        error: errorMessage,
        type: task.type
      });
      this.emit('task:failed', task.id, errorMessage);
    } finally {
      this.runningTasks.delete(task.id);
      
      setImmediate(() => this.scheduleNextTasks());
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getRunningTasksCount(): number {
    return this.runningTasks.size;
  }

  getRunningTaskIds(): string[] {
    return Array.from(this.runningTasks);
  }

  getMaxConcurrentTasks(): number {
    return this.maxConcurrentTasks;
  }
}
