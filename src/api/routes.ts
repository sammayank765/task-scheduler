import { Router, Request, Response } from 'express';
import { DatabaseManager } from '../storage/database';
import { TaskValidator } from '../engine/validator';
import { TaskExecutor } from '../engine/executor';
import { TaskInput } from '../types/task';
import { logger } from '../utils/logger';

export function createRoutes(
  db: DatabaseManager, 
  validator: TaskValidator, 
  executor: TaskExecutor
): Router {
  const router = Router();

  router.post('/tasks', (req: Request, res: Response) => {
    try {
      const taskInput: TaskInput = req.body;

      const validation = validator.validateTaskInput(taskInput);
      
      if (!validation.valid) {
        return res.status(400).json({
          error: validation.error
        });
      }

      const task = validator.createTask(taskInput);

      const inserted = db.insertTask(task);

      if (!inserted) {
        return res.status(409).json({
          error: `Task with ID ${task.id} already exists`
        });
      }

      logger.info(`Task ${task.id} submitted with status ${task.status}`, {
        taskId: task.id,
        type: task.type,
        status: task.status,
        dependencies: task.dependencies
      });

      return res.status(201).json({
        message: 'Task submitted successfully',
        task: {
          id: task.id,
          type: task.type,
          duration_ms: task.duration_ms,
          dependencies: task.dependencies,
          status: task.status,
          created_at: task.created_at
        }
      });
    } catch (error) {
      logger.error('Error submitting task', { error: error instanceof Error ? error.message : error });
      return res.status(500).json({
        error: 'Internal server error'
      });
    }
  });

  router.get('/tasks/:id', (req: Request, res: Response) => {
    try {
      const taskId = req.params.id;
      const task = db.getTask(taskId);

      if (!task) {
        return res.status(404).json({
          error: `Task ${taskId} not found`
        });
      }

      return res.json({
        id: task.id,
        type: task.type,
        duration_ms: task.duration_ms,
        dependencies: task.dependencies,
        status: task.status,
        created_at: task.created_at,
        started_at: task.started_at,
        completed_at: task.completed_at,
        error: task.error,
        retry_count: task.retry_count
      });
    } catch (error) {
      logger.error('Error getting task', { 
        error: error instanceof Error ? error.message : error,
        taskId: req.params.id
      });
      return res.status(500).json({
        error: 'Internal server error'
      });
    }
  });

  router.get('/tasks', (req: Request, res: Response) => {
    try {
      const statusFilter = req.query.status as string | undefined;
      
      let tasks;
      
      if (statusFilter) {
        tasks = db.getTasksByStatus(statusFilter as any);
      } else {
        tasks = db.getAllTasks();
      }

      return res.json({
        total: tasks.length,
        tasks: tasks.map(task => ({
          id: task.id,
          type: task.type,
          duration_ms: task.duration_ms,
          dependencies: task.dependencies,
          status: task.status,
          created_at: task.created_at,
          started_at: task.started_at,
          completed_at: task.completed_at,
          error: task.error
        }))
      });
    } catch (error) {
      logger.error('Error listing tasks', { 
        error: error instanceof Error ? error.message : error,
        statusFilter: req.query.status
      });
      return res.status(500).json({
        error: 'Internal server error'
      });
    }
  });

  router.get('/stats', (req: Request, res: Response) => {
    try {
      const stats = db.getStats();
      const runningTaskIds = executor.getRunningTaskIds();
      const maxConcurrent = executor.getMaxConcurrentTasks();

      return res.json({
        ...stats,
        max_concurrent_tasks: maxConcurrent,
        currently_running: runningTaskIds,
        slots_available: maxConcurrent - runningTaskIds.length
      });
    } catch (error) {
      logger.error('Error getting stats', { error: error instanceof Error ? error.message : error });
      return res.status(500).json({
        error: 'Internal server error'
      });
    }
  });

  router.get('/health', (req: Request, res: Response) => {
    return res.json({
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
