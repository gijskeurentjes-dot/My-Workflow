import {
  API_BASE,
  type Agent,
  type AgentArchetype,
  type ApprovalRequest,
  type Id,
  type Project,
  type Task,
  type TaskPriority,
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
  name: string;
  description?: string;
  color?: string;
  /** Who to hire onto the new project. Defaults to a project manager. */
  team?: AgentArchetype[];
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

  createTask: (input: CreateTaskInput) => post<Task>('/tasks', input),
  updateTask: (
    id: Id,
    input: {
      title?: string;
      description?: string;
      needsApproval?: boolean;
      priority?: TaskPriority;
    },
  ) => patch<Task>(`/tasks/${id}`, input),
  deleteTask: (id: Id) => del<{ ok: true }>(`/tasks/${id}`),

  assignTask: (id: Id, agentId: Id) => post<unknown>(`/tasks/${id}/assign`, { agentId }),
  unassignTask: (id: Id) => post<unknown>(`/tasks/${id}/unassign`),
  startTask: (id: Id) => post<unknown>(`/tasks/${id}/start`),
  pauseTask: (id: Id) => post<unknown>(`/tasks/${id}/pause`),
  cancelTask: (id: Id) => post<unknown>(`/tasks/${id}/cancel`),
  retryTask: (id: Id) => post<unknown>(`/tasks/${id}/retry`),
  resetTask: (id: Id) => post<unknown>(`/tasks/${id}/reset`),

  hireAgent: (projectId: Id, archetype: AgentArchetype, name?: string) =>
    post<Agent>('/agents', { projectId, archetype, name }),
  updateAgent: (id: Id, input: UpdateAgentInput) => patch<Agent>(`/agents/${id}`, input),
  dismissAgent: (id: Id) => del<{ ok: true }>(`/agents/${id}`),

  approve: (id: Id) => post<ApprovalRequest>(`/approvals/${id}/approve`),
  reject: (id: Id, note?: string) => post<ApprovalRequest>(`/approvals/${id}/reject`, { note }),
};
