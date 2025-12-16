import { DatabaseManager } from './storage/database';
import { TaskValidator } from './engine/validator';
import { TaskExecutor } from './engine/executor';
import { createServer } from './api/server';
import { logger } from './utils/logger';

function main() {
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const MAX_CONCURRENT_TASKS = process.env.MAX_CONCURRENT_TASKS 
    ? parseInt(process.env.MAX_CONCURRENT_TASKS) 
    : 3;

  logger.info('='.repeat(60));
  logger.info('Starting Distributed Task Scheduler');
  logger.info('='.repeat(60));

  logger.info('Initializing database...');
  const db = new DatabaseManager();

  logger.info('Initializing task validator...');
  const validator = new TaskValidator(db);

  logger.info(`Initializing task executor (max concurrent: ${MAX_CONCURRENT_TASKS})...`);
  const executor = new TaskExecutor(db, MAX_CONCURRENT_TASKS);
  executor.start();

  logger.info(`Starting API server on port ${PORT}...`);
  const app = createServer(db, validator, executor, PORT);

  const server = app.listen(PORT, () => {
    logger.info('='.repeat(60));
    logger.info(`Server is running on http://localhost:${PORT}`);
    logger.info(`Max concurrent tasks: ${MAX_CONCURRENT_TASKS}`);
    logger.info(`Database initialized`);
    logger.info(`Task executor running`);
    logger.info('='.repeat(60));
    logger.info('API Endpoints:');
    logger.info(`  POST   http://localhost:${PORT}/api/tasks       - Submit task`);
    logger.info(`  GET    http://localhost:${PORT}/api/tasks/:id   - Get task status`);
    logger.info(`  GET    http://localhost:${PORT}/api/tasks       - List all tasks`);
    logger.info(`  GET    http://localhost:${PORT}/api/stats       - Get statistics`);
    logger.info(`  GET    http://localhost:${PORT}/api/health      - Health check`);
    logger.info('='.repeat(60));
  });

  const shutdown = () => {
    logger.info('Shutting down gracefully...');
    
    executor.stop();
    
    server.close(() => {
      logger.info('Server closed');
      db.close();
      logger.info('Database closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
