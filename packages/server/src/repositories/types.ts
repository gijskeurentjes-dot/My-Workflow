import type {
  ActivityEvent,
  ActivityEventType,
  Agent,
  AgentMovement,
  AgentStatus,
  ApprovalRequest,
  ApprovalStatus,
  Id,
  PlotKey,
  Project,
  Milestone,
  MilestoneStatus,
  ProjectFile,
  ProjectStatus,
  RunMode,
  Task,
  UsageSummary,
  TaskPriority,
  TaskResult,
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

export interface ProjectPatch {
  name?: string;
  description?: string;
  /** What done looks like. */
  goals?: string;
  /** Where the code lives. */
  repository?: string;
  status?: ProjectStatus;
  color?: string;
}

export interface ProjectRepository {
  list(filter?: { status?: ProjectStatus }): Project[];
  findById(id: Id): Project | null;
  /** Used to pick a distinct island appearance for the next project. */
  count(): number;
  create(project: Project): Project;
  update(id: Id, patch: ProjectPatch): Project | null;
  delete(id: Id): boolean;
  /** Increment the delivered-crate count and return the updated project. */
  addCrate(id: Id): Project | null;
}

/** Only the mutable half of an agent. Its archetype is fixed at hiring. */
export interface AgentPatch {
  /** Agents can be moved between projects. */
  projectId?: Id;
  name?: string;
  role?: string;
  instructions?: string;
  tools?: string[];
  model?: string;
  maxExecutionMs?: number;
  maxOutputTokens?: number;
  requiresApproval?: boolean;
  status?: AgentStatus;
  currentTaskId?: Id | null;
  currentLocation?: PlotKey;
  movement?: AgentMovement | null;
  progress?: number;
  /**
   * When this change happened. The agent engine passes its own tick time so
   * that durations it measures against `updatedAt` stay correct under a
   * controlled clock. Defaults to now.
   */
  updatedAt?: number;
}

export interface AgentRepository {
  list(): Agent[];
  findById(id: Id): Agent | null;
  findByProject(projectId: Id): Agent[];
  create(agent: Agent): Agent;
  update(id: Id, patch: AgentPatch): Agent | null;
  delete(id: Id): boolean;
}

export interface TaskFilter {
  projectId?: Id;
  assignedAgentId?: Id;
  status?: TaskStatus | TaskStatus[];
  type?: TaskType;
  priority?: TaskPriority;
  buildingKey?: PlotKey;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedAgentId?: Id | null;
  progress?: number;
  /** Set when a real agent takes the work over from the simulation. */
  runMode?: RunMode;
  /** The task this one breaks out of. */
  parentTaskId?: Id | null;
  /** Which milestone it counts towards. */
  milestoneId?: Id | null;
  needsApproval?: boolean;
  blocker?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface TaskRepository {
  list(filter?: TaskFilter): Task[];
  findById(id: Id): Task | null;
  create(task: Task): Task;
  update(id: Id, patch: TaskPatch): Task | null;
  delete(id: Id): boolean;
  /** Tasks an engine tick could advance, most urgent first. */
  listAdvanceable(): Task[];
  /** Record that `taskId` cannot start until `dependsOnId` is finished. */
  addDependency(taskId: Id, dependsOnId: Id): Task | null;
  removeDependency(taskId: Id, dependsOnId: Id): Task | null;
  /** Tasks that are waiting on this one. */
  listDependents(taskId: Id): Id[];
}

export interface MilestonePatch {
  title?: string;
  description?: string;
  dueAt?: number | null;
  status?: MilestoneStatus;
}

export interface MilestoneRepository {
  list(projectId?: Id): Milestone[];
  findById(id: Id): Milestone | null;
  create(milestone: Milestone): Milestone;
  update(id: Id, patch: MilestonePatch): Milestone | null;
  delete(id: Id): boolean;
}

export interface ProjectFileRepository {
  list(filter?: { projectId?: Id; taskId?: Id }): ProjectFile[];
  findById(id: Id): ProjectFile | null;
  create(file: ProjectFile): ProjectFile;
  delete(id: Id): boolean;
}

export interface ApprovalRepository {
  list(filter?: { status?: ApprovalStatus }): ApprovalRequest[];
  findById(id: Id): ApprovalRequest | null;
  findPendingByTask(taskId: Id): ApprovalRequest | null;
  /** Everything this agent is currently waiting on you for. */
  findPendingByAgent(agentId: Id): ApprovalRequest[];
  create(request: ApprovalRequest): ApprovalRequest;
  decide(
    id: Id,
    status: Exclude<ApprovalStatus, 'pending'>,
    note: string | null,
  ): ApprovalRequest | null;
}

export interface ActivityFilter {
  projectId?: Id;
  taskId?: Id;
  agentId?: Id;
  eventType?: ActivityEventType;
  limit?: number;
}

/** What agents produced. Append-only: a rerun adds a result, never replaces one. */
export interface TaskResultRepository {
  create(result: TaskResult): TaskResult;
  /** What every live run has cost, all together. */
  totalUsage(): UsageSummary;
  usageByAgent(): { agentId: Id; usage: UsageSummary }[];
  usageByTask(): { taskId: Id; usage: UsageSummary }[];
  /** Newest first, so the latest attempt reads as the current answer. */
  listByTask(taskId: Id): TaskResult[];
  findLatestByTask(taskId: Id): TaskResult | null;
}

export interface ActivityRepository {
  list(filter?: ActivityFilter): ActivityEvent[];
  create(event: ActivityEvent): ActivityEvent;
}

/** Everything the service layer is handed at construction. */
export interface Repositories {
  projects: ProjectRepository;
  agents: AgentRepository;
  tasks: TaskRepository;
  milestones: MilestoneRepository;
  files: ProjectFileRepository;
  approvals: ApprovalRepository;
  activity: ActivityRepository;
  results: TaskResultRepository;
  /**
   * Run a block atomically. SQLite gives this for free; a Postgres
   * implementation would open a transaction and pass a scoped client.
   */
  transaction<T>(fn: () => T): T;
  /** Remove all rows. Backs the "reset demo data" action. */
  reset(): void;
}
