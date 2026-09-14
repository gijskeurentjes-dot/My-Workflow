import type {
  ActivityEvent,
  ActivityKind,
  ApprovalRequest,
  ApprovalStatus,
  Bot,
  BotKey,
  Id,
  Island,
  IslandKey,
  Project,
  ProjectStatus,
  Task,
  TaskStatus,
  TaskType,
} from '@ai-islands/shared';

/**
 * The persistence seam.
 *
 * Everything above this file — services, the agent engine, the routes — depends
 * only on these interfaces. Adding PostgreSQL means writing a second set of
 * implementations; no caller changes.
 */

export interface IslandRepository {
  list(): Island[];
  findById(id: Id): Island | null;
  findByKey(key: IslandKey): Island | null;
  create(island: Island): Island;
  /** Increment the delivered-crate count and return the new island. */
  addCrate(id: Id): Island | null;
}

export interface BotRepository {
  list(): Bot[];
  findById(id: Id): Bot | null;
  findByKey(key: BotKey): Bot | null;
  findByIsland(islandId: Id): Bot[];
  create(bot: Bot): Bot;
  update(id: Id, patch: BotPatch): Bot | null;
}

/** Only the mutable half of a bot. Identity and island are fixed at creation. */
export interface BotPatch {
  status?: Bot['status'];
  taskId?: Id | null;
  locationKey?: Bot['locationKey'];
  movement?: Bot['movement'];
  progress?: number;
  /**
   * When this change happened. The agent engine passes its own tick time so
   * that durations it measures against `updatedAt` — how long a bot has been
   * celebrating, for instance — stay correct under a controlled clock.
   * Defaults to now.
   */
  updatedAt?: number;
}

export interface ProjectRepository {
  list(filter?: { status?: ProjectStatus }): Project[];
  findById(id: Id): Project | null;
  create(project: Project): Project;
  update(id: Id, patch: Partial<Pick<Project, 'name' | 'goal' | 'status' | 'color'>>): Project | null;
  delete(id: Id): boolean;
}

export interface TaskFilter {
  projectId?: Id;
  islandId?: Id;
  botId?: Id;
  status?: TaskStatus | TaskStatus[];
  type?: TaskType;
}

export interface TaskRepository {
  list(filter?: TaskFilter): Task[];
  findById(id: Id): Task | null;
  create(task: Task): Task;
  update(id: Id, patch: TaskPatch): Task | null;
  delete(id: Id): boolean;
  /** Tasks an engine tick could advance, in creation order. */
  listAdvanceable(): Task[];
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  status?: TaskStatus;
  botId?: Id | null;
  progress?: number;
  needsApproval?: boolean;
  blocker?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface ApprovalRepository {
  list(filter?: { status?: ApprovalStatus }): ApprovalRequest[];
  findById(id: Id): ApprovalRequest | null;
  findPendingByTask(taskId: Id): ApprovalRequest | null;
  create(request: ApprovalRequest): ApprovalRequest;
  decide(id: Id, status: Exclude<ApprovalStatus, 'pending'>, note: string | null): ApprovalRequest | null;
}

export interface ActivityFilter {
  projectId?: Id;
  taskId?: Id;
  botId?: Id;
  islandId?: Id;
  kind?: ActivityKind;
  limit?: number;
}

export interface ActivityRepository {
  list(filter?: ActivityFilter): ActivityEvent[];
  create(event: ActivityEvent): ActivityEvent;
}

/** Everything the service layer is handed at construction. */
export interface Repositories {
  islands: IslandRepository;
  bots: BotRepository;
  projects: ProjectRepository;
  tasks: TaskRepository;
  approvals: ApprovalRepository;
  activity: ActivityRepository;
  /**
   * Run a block atomically. SQLite gives this for free; a Postgres
   * implementation would open a transaction and pass a scoped client.
   */
  transaction<T>(fn: () => T): T;
  /** Remove all rows. Backs the "reset demo data" action. */
  reset(): void;
}
