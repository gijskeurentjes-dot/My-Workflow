import {
  API_BASE,
  type Agent,
  type AgentArchetype,
  type ApprovalRequest,
  type Id,
  type Milestone,
  type MilestoneStatus,
  type MilestoneView,
  type Project,
  type ProjectFile,
  type ProjectFileKind,
  type ProjectTemplate,
  type RuntimeInfo,
  type Task,
  type TaskPriority,
  type TaskResult,
  type TaskType,
  type WorldSnapshot,
} from '@ai-islands/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    // The API reports refusals as { error } with the rule that was broken, so
    // surface that rather than a generic failure whenever it is there.
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Body was not JSON; the status is the best we have.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export interface CreateProjectInput {
  /** Optional for a deal room, which names itself. */
  name?: string;
  description?: string;
  /** What done looks like, one goal per line. */
  goals?: string;
  /** Where the code lives. */
  repository?: string;
  color?: string;
  /** Who to hire onto the new project. Defaults to a project manager. */
  team?: AgentArchetype[];
  /** Which kind of project. A deal room brings its own fixed team of five. */
  template?: ProjectTemplate;
}

export interface CreateTaskInput {
  projectId: Id;
  title: string;
  description?: string;
  type: TaskType;
  priority?: TaskPriority;
  needsApproval?: boolean;
  agentId?: Id | null;
  autoStart?: boolean;
  /** The task this one breaks out of. */
  parentTaskId?: Id | null;
  /** Which milestone it counts towards. */
  milestoneId?: Id | null;
  /** Tasks that must finish before this one can start. */
  dependsOn?: Id[];
}

/** An agent's brief: what a real engine would send as its system prompt. */
export interface UpdateAgentInput {
  name?: string;
  role?: string;
  instructions?: string;
  tools?: string[];
}

/**
 * The write API.
 *
 * Each action is its own endpoint rather than a status field the client sets,
 * so which transitions are legal stays on the server. A refused command comes
 * back as an ApiError carrying the rule it broke.
 *
 * Mutations do not merge their own responses into local state: the same command
 * broadcasts over the event stream, and letting that single path update
 * everyone keeps every open screen in step.
 */
export const api = {
  world: () => request<WorldSnapshot>('/world'),
  resetDemoData: () => post<WorldSnapshot>('/reset'),

  createProject: (input: CreateProjectInput) => post<Project>('/projects', input),
  updateProject: (id: Id, input: Partial<CreateProjectInput> & { status?: Project['status'] }) =>
    patch<Project>(`/projects/${id}`, input),
  deleteProject: (id: Id) => del<{ ok: true }>(`/projects/${id}`),

  milestones: (projectId: Id) => request<MilestoneView[]>(`/projects/${projectId}/milestones`),
  createMilestone: (
    projectId: Id,
    input: { title: string; description?: string; dueAt?: number | null },
  ) => post<Milestone>(`/projects/${projectId}/milestones`, input),
  updateMilestone: (
    projectId: Id,
    milestoneId: Id,
    input: { title?: string; description?: string; dueAt?: number | null; status?: MilestoneStatus },
  ) => patch<Milestone>(`/projects/${projectId}/milestones/${milestoneId}`, input),
  deleteMilestone: (projectId: Id, milestoneId: Id) =>
    del<{ ok: true }>(`/projects/${projectId}/milestones/${milestoneId}`),

  files: (projectId: Id) => request<ProjectFile[]>(`/projects/${projectId}/files`),
  addFile: (
    projectId: Id,
    input: {
      name: string;
      kind?: ProjectFileKind;
      location?: string;
      note?: string;
      taskId?: Id | null;
    },
  ) => post<ProjectFile>(`/projects/${projectId}/files`, input),
  removeFile: (projectId: Id, fileId: Id) =>
    del<{ ok: true }>(`/projects/${projectId}/files/${fileId}`),

  createTask: (input: CreateTaskInput) => post<Task>('/tasks', input),
  updateTask: (
    id: Id,
    input: {
      title?: string;
      description?: string;
      needsApproval?: boolean;
      priority?: TaskPriority;
      milestoneId?: Id | null;
    },
  ) => patch<Task>(`/tasks/${id}`, input),
  deleteTask: (id: Id) => del<{ ok: true }>(`/tasks/${id}`),

  assignTask: (id: Id, agentId: Id) => post<unknown>(`/tasks/${id}/assign`, { agentId }),
  unassignTask: (id: Id) => post<unknown>(`/tasks/${id}/unassign`),
  startTask: (id: Id) => post<unknown>(`/tasks/${id}/start`),
  pauseTask: (id: Id) => post<unknown>(`/tasks/${id}/pause`),
  cancelTask: (id: Id) => post<unknown>(`/tasks/${id}/cancel`),
  retryTask: (id: Id) => post<unknown>(`/tasks/${id}/retry`),
  /** Move between the lanes a person drives by hand. */
  moveTask: (id: Id, to: 'backlog' | 'todo' | 'review') =>
    post<unknown>(`/tasks/${id}/move`, { to }),
  /** Finish a task you were reviewing: it goes out like approved work. */
  signOffTask: (id: Id) => post<unknown>(`/tasks/${id}/sign-off`),
  addDependency: (id: Id, dependsOnId: Id) =>
    post<unknown>(`/tasks/${id}/dependencies`, { dependsOnId }),
  removeDependency: (id: Id, dependsOnId: Id) =>
    del<unknown>(`/tasks/${id}/dependencies/${dependsOnId}`),
  resetTask: (id: Id) => post<unknown>(`/tasks/${id}/reset`),

  hireAgent: (projectId: Id, archetype: AgentArchetype, name?: string) =>
    post<Agent>('/agents', { projectId, archetype, name }),
  updateAgent: (id: Id, input: UpdateAgentInput) => patch<Agent>(`/agents/${id}`, input),
  dismissAgent: (id: Id) => del<{ ok: true }>(`/agents/${id}`),

  /**
   * Hand this task to a real agent.
   *
   * Deliberately separate from `startTask`: one simulates the work, the other
   * spends money doing it, and a single button that might do either would be a
   * trap. Answers as soon as the run is accepted — everything after that
   * arrives on the event stream.
   */
  runTask: (id: Id) => post<{ started: true; taskId: Id }>(`/tasks/${id}/run`),
  /** Stop a live run. The task is left cancelled, with its history intact. */
  stopTask: (id: Id) => post<{ stopped: true; taskId: Id }>(`/tasks/${id}/stop`),
  /** Everything a task has produced, newest first. */
  taskResults: (id: Id) => request<TaskResult[]>(`/tasks/${id}/results`),
  runtime: () => request<RuntimeInfo>('/runtime'),

  approve: (id: Id) => post<ApprovalRequest>(`/approvals/${id}/approve`),
  reject: (id: Id, note?: string) => post<ApprovalRequest>(`/approvals/${id}/reject`, { note }),
  /**
   * Withdraw the request and call the work off.
   *
   * Its own endpoint rather than a flag on reject, because they are different
   * answers: refusing an action leaves the agent working, cancelling ends it.
   */
  cancelApproval: (id: Id, note?: string) =>
    post<ApprovalRequest>(`/approvals/${id}/cancel`, { note }),
};
