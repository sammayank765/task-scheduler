import express, { Express } from 'express';
import { DatabaseManager } from '../storage/database';
import { TaskValidator } from '../engine/validator';
import { TaskExecutor } from '../engine/executor';
import { createRoutes } from './routes';
import { logger } from '../utils/logger';

export function createServer(
  db: DatabaseManager,
  validator: TaskValidator,
  executor: TaskExecutor,
  port: number = 3000
): Express {
  const app = express();

  app.use(express.json());

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      logger.warn('Invalid JSON in request body', { 
        error: err.message,
        path: req.path,
        method: req.method
      });
      return res.status(400).json({
        error: 'Invalid JSON in request body'
      });
    }
    next(err);
  });


  const apiRoutes = createRoutes(db, validator, executor);
  app.use('/api', apiRoutes);

  app.get('/', (req, res) => {
    res.json({
      name: 'Distributed Task Scheduler',
      version: '1.0.0',
      endpoints: {
        submit_task: 'POST /api/tasks',
        get_task: 'GET /api/tasks/:id',
        list_tasks: 'GET /api/tasks',
        stats: 'GET /api/stats',
        health: 'GET /api/health'
      }
    });
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', { 
      error: err.message,
      stack: err.stack,
      path: req.path
    });
    res.status(500).json({
      error: 'Internal server error'
    });
  });

  return app;
}
