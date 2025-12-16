import { TaskInput, Task, TaskStatus } from '../types/task';
import { DatabaseManager } from '../storage/database';

export class TaskValidator {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  validateTaskInput(taskInput: TaskInput): { valid: boolean; error?: string } {
    if (!taskInput.id || typeof taskInput.id !== 'string') {
      return { valid: false, error: 'Task ID is required and must be a string' };
    }

    if (!taskInput.type || typeof taskInput.type !== 'string') {
      return { valid: false, error: 'Task type is required and must be a string' };
    }

    if (typeof taskInput.duration_ms !== 'number' || taskInput.duration_ms < 0) {
      return { valid: false, error: 'duration_ms must be a non-negative number' };
    }

    const existingTask = this.db.getTask(taskInput.id);
    if (existingTask) {
      return { valid: false, error: `Task with ID ${taskInput.id} already exists` };
    }

    const dependencies = taskInput.dependencies || [];
    
    if (!Array.isArray(dependencies)) {
      return { valid: false, error: 'dependencies must be an array' };
    }

    for (const depId of dependencies) {
      if (!depId || typeof depId !== 'string' || depId.trim() === '') {
        return { valid: false, error: 'Dependency IDs must be non-empty strings' };
      }

      if (depId === taskInput.id) {
        return { valid: false, error: 'Task cannot depend on itself' };
      }

      const dependencyTask = this.db.getTask(depId);
      if (!dependencyTask) {
        return { 
          valid: false, 
          error: `Dependency '${depId}' does not exist. Please submit dependencies before dependent tasks.` 
        };
      }
    }

    const cycleCheck = this.detectCycle(taskInput.id, dependencies);
    if (!cycleCheck.valid) {
      return cycleCheck;
    }

    return { valid: true };
  }

  private detectCycle(newTaskId: string, newDependencies: string[]): { valid: boolean; error?: string } {
    const graph = new Map<string, string[]>();
    const allTasks = this.db.getAllTasks();
    for (const task of allTasks) {
      graph.set(task.id, task.dependencies);
    }
    
    graph.set(newTaskId, newDependencies);

    for (const depId of newDependencies) {
      if (this.hasCycle(depId, newTaskId, graph, new Set())) {
        return { 
          valid: false, 
          error: `Adding task ${newTaskId} would create a circular dependency with ${depId}` 
        };
      }
    }

    return { valid: true };
  }

  private hasCycle(
    current: string, 
    target: string, 
    graph: Map<string, string[]>, 
    visited: Set<string>
  ): boolean {
    if (current === target) {
      return true;
    }

    if (visited.has(current)) {
      return false;
    }

    visited.add(current);

    const dependencies = graph.get(current);
    if (!dependencies) {
      return false;
    }

    for (const dep of dependencies) {
      if (this.hasCycle(dep, target, graph, visited)) {
        return true;
      }
    }

    return false;
  }

  createTask(taskInput: TaskInput): Task {
    const allTasks = this.db.getAllTasks();
    const completedTaskIds = new Set(
      allTasks.filter(t => t.status === TaskStatus.COMPLETED).map(t => t.id)
    );

    const dependencies = taskInput.dependencies || [];
    
    // Determine initial status
    let status: TaskStatus;
    
    if (dependencies.length === 0) {
      status = TaskStatus.QUEUED; // No dependencies, ready to run
    } else if (dependencies.every(depId => completedTaskIds.has(depId))) {
      status = TaskStatus.QUEUED; // All dependencies already completed
    } else {
      status = TaskStatus.WAITING; // Waiting for dependencies
    }

    return {
      id: taskInput.id,
      type: taskInput.type,
      duration_ms: taskInput.duration_ms,
      dependencies,
      status,
      created_at: Date.now()
    };
  }
}
