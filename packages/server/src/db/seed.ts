import {
  ARCHETYPES,
  buildApprovalRequest,
  DEMO_PROJECTS,
  TASK_TYPES,
  appearanceForIndex,
  defaultInstructions,
  homePlotFor,
  type ActivityEvent,
  type ActivityEventType,
  type Agent,
  type AgentArchetype,
  type Project,
  type Task,
  type TaskPriority,
  type TaskType,
} from '@ai-islands/shared';
import { DEFAULT_AGENT_MODEL } from '../config.js';
import { newId } from '../ids.js';
import { RESEARCH_DEFAULTS } from '../services/agents/claude/nova.js';
import type { Repositories } from '../repositories/types.js';

/**
 * The demo world: three projects, each its own island with its own team.
 *
 * It is written to show every state at a glance — someone working, someone
 * waiting on you, someone blocked, someone paused and someone idle — and to
 * show teams of different shapes, because a project decides who it hires.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface SeedAgent {
  key: string;
  project: string;
  archetype: AgentArchetype;
  /** Override the archetype's default name, so teams do not all look alike. */
  name?: string;
}

interface SeedTask {
  key: string;
  project: string;
  title: string;
  description: string;
  type: TaskType;
  status: Task['status'];
  priority?: TaskPriority;
  agent: string | null;
  progress?: number;
  durationSeconds?: number;
  needsApproval?: boolean;
  blocker?: string;
  completedAgo?: number;
}

/** Project keys, in the order they are created. */
const LAUNCH = 'launch';
const RESEARCH = 'research';
const BUDGET = 'budget';

const SEED_AGENTS: SeedAgent[] = [
  // A launch needs coordination, building and a deck: three specialists.
  { key: 'atlas', project: LAUNCH, archetype: 'pm' },
  { key: 'forge', project: LAUNCH, archetype: 'developer' },
  { key: 'slides', project: LAUNCH, archetype: 'presenter' },

  // Research is a smaller team.
  { key: 'nova', project: RESEARCH, archetype: 'researcher' },
  { key: 'cortex', project: RESEARCH, archetype: 'pm', name: 'Cortex' },

  // And the budget is mostly one analyst with someone to present it.
  { key: 'excel', project: BUDGET, archetype: 'analyst' },
  { key: 'quill', project: BUDGET, archetype: 'presenter', name: 'Quill' },
];

const SEED_TASKS: SeedTask[] = [
  // ── Someone is working ────────────────────────────────────────────────────
  {
    key: 'breakdown',
    project: LAUNCH,
    title: 'Break the launch into workstreams',
    description: 'Sequence the pricing page, the deck and the revenue model.',
    type: 'planning',
    status: 'working',
    priority: 'high',
    agent: 'atlas',
    progress: 44,
    durationSeconds: 150,
  },
  {
    key: 'revenue-model',
    project: BUDGET,
    title: 'Q4 revenue model',
    description: 'Base, upside and downside cases with the assumptions labelled.',
    type: 'analysis',
    status: 'working',
    agent: 'excel',
    progress: 27,
    durationSeconds: 135,
  },

  // ── Someone needs you ─────────────────────────────────────────────────────
  {
    key: 'competitors',
    project: RESEARCH,
    title: 'Competitor landscape scan',
    description: 'Pricing tiers, positioning and recent launches for the top three.',
    type: 'research',
    status: 'waiting_approval',
    priority: 'high',
    agent: 'nova',
    progress: 100,
    durationSeconds: 120,
  },

  // ── Someone is blocked ────────────────────────────────────────────────────
  {
    key: 'checkout',
    project: LAUNCH,
    title: 'Fix the checkout regression',
    description: 'Card payments fail on the annual plan after the pricing change.',
    type: 'coding',
    status: 'failed',
    priority: 'urgent',
    agent: 'forge',
    progress: 38,
    durationSeconds: 130,
    blocker: 'The staging payment gateway is rejecting test cards — needs a credential from you.',
  },

  // ── Someone is paused ─────────────────────────────────────────────────────
  {
    key: 'launch-deck',
    project: LAUNCH,
    title: 'Launch deck: storyline and slides',
    description: 'Twelve slides, speaker notes, one chart per claim.',
    type: 'writing',
    status: 'paused',
    agent: 'slides',
    progress: 61,
    durationSeconds: 140,
  },

  // ── Waiting on the board ──────────────────────────────────────────────────
  {
    key: 'pricing-page',
    project: LAUNCH,
    title: 'Build the new pricing page',
    description: 'Three tiers, annual toggle, and the comparison table.',
    type: 'coding',
    status: 'backlog',
    priority: 'urgent',
    agent: null,
  },
  {
    key: 'interviews',
    project: RESEARCH,
    title: 'Summarise the customer interviews',
    description: 'Nine transcripts. Pull the themes and the direct quotes.',
    type: 'research',
    status: 'backlog',
    agent: null,
  },
  {
    key: 'budget-deck',
    project: BUDGET,
    title: 'Budget review deck',
    description: 'One slide per cost centre with the variance called out.',
    type: 'writing',
    status: 'backlog',
    priority: 'low',
    agent: null,
  },
  {
    key: 'launch-review',
    project: LAUNCH,
    title: 'Review the launch checklist',
    description: 'Everything that has to be true before we announce.',
    type: 'review',
    status: 'backlog',
    priority: 'high',
    agent: null,
  },

  // ── Already delivered ─────────────────────────────────────────────────────
  {
    key: 'source-library',
    project: RESEARCH,
    title: 'Build the source library',
    description: 'Every source tagged, de-duplicated and dated.',
    type: 'research',
    status: 'completed',
    agent: 'nova',
    progress: 100,
    completedAgo: 5 * HOUR,
  },
  {
    key: 'cost-baseline',
    project: BUDGET,
    title: 'FY25 cost baseline',
    description: 'Actuals by cost centre, reconciled to the ledger.',
    type: 'analysis',
    status: 'completed',
    agent: 'excel',
    progress: 100,
    completedAgo: 20 * HOUR,
  },
];

/** Where an agent stands, given what it is doing. */
function locationFor(status: Agent['status'], archetype: AgentArchetype, task?: SeedTask): Agent['currentLocation'] {
  if (status === 'waiting_approval') return 'hq';
  if ((status === 'working' || status === 'failed' || status === 'paused') && task) {
    return TASK_TYPES[task.type].building;
  }
  return homePlotFor(archetype);
}

export interface SeedResult {
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
}

/**
 * Write the demo world. Assumes the tables are empty — callers that are
 * resetting should clear them first via `repositories.reset()`.
 */
export function seedWorld(repos: Repositories, now: number = Date.now()): SeedResult {
  return repos.transaction(() => {
    // ── Projects ────────────────────────────────────────────────────────────
    const projectByKey = new Map<string, Project>();
    const keys = [LAUNCH, RESEARCH, BUDGET];

    DEMO_PROJECTS.forEach((definition, index) => {
      const project = repos.projects.create({
        id: newId('prj'),
        name: definition.name,
        description: definition.description,
        goals: definition.goals,
        repository: definition.repository,
        status: 'active',
        template: 'standard',
        color: definition.color,
        appearance: appearanceForIndex(index),
        crates: 0,
        createdAt: now - 2 * HOUR,
        updatedAt: now,
      });
      projectByKey.set(keys[index]!, project);
    });

    // ── Agents ──────────────────────────────────────────────────────────────
    // Status is decided by the task each agent holds, so the two can never
    // disagree. Agents with no seeded task start idle at their home building.
    const taskByAgentKey = new Map<string, SeedTask>();
    for (const t of SEED_TASKS) {
      if (!t.agent || t.status === 'completed') continue;
      taskByAgentKey.set(t.agent, t);
    }

    const agentByKey = new Map<string, Agent>();
    for (const definition of SEED_AGENTS) {
      const project = projectByKey.get(definition.project);
      if (!project) throw new Error(`Seed: no project for agent ${definition.key}`);

      const profile = ARCHETYPES[definition.archetype];
      const heldTask = taskByAgentKey.get(definition.key);
      const status: Agent['status'] = heldTask
        ? heldTask.status === 'working'
          ? 'working'
          : heldTask.status === 'waiting_approval'
            ? 'waiting_approval'
            : heldTask.status === 'failed'
              ? 'failed'
              : heldTask.status === 'paused'
                ? 'paused'
                : 'idle'
        : 'idle';

      const agent = repos.agents.create({
        id: newId('agt'),
        projectId: project.id,
        archetype: definition.archetype,
        name: definition.name ?? profile.defaultName,
        role: profile.title,
        instructions: defaultInstructions(profile),
        tools: [...profile.tools],
        // Execution limits travel with the agent, so a run has a ceiling
        // even if nobody thought about it when the agent was hired.
        model: DEFAULT_AGENT_MODEL,
        maxExecutionMs: RESEARCH_DEFAULTS.maxExecutionMs,
        maxOutputTokens: RESEARCH_DEFAULTS.maxOutputTokens,
        requiresApproval: RESEARCH_DEFAULTS.requiresApproval,
        status,
        currentTaskId: null, // linked below, once the tasks exist
        currentLocation: locationFor(status, definition.archetype, heldTask),
        movement: null,
        progress: 0,
        createdAt: now - 2 * HOUR,
        updatedAt: now,
      });
      agentByKey.set(definition.key, agent);
    }

    // ── Tasks ───────────────────────────────────────────────────────────────
    const taskByKey = new Map<string, Task>();

    for (const t of SEED_TASKS) {
      const project = projectByKey.get(t.project);
      if (!project) throw new Error(`Seed: bad task ${t.key}`);

      const agent = t.agent ? agentByKey.get(t.agent) : null;
      const progress = t.progress ?? 0;

      const task = repos.tasks.create({
        id: newId('tsk'),
        projectId: project.id,
        assignedAgentId: agent?.id ?? null,
        title: t.title,
        description: t.description,
        type: t.type,
        status: t.status,
        priority: t.priority ?? 'normal',
        buildingKey: TASK_TYPES[t.type].building,
        progress,
        // The demo world is the simulation; only a real run says otherwise.
        runMode: 'simulated',
        parentTaskId: null,
        milestoneId: null,
        dependsOn: [],
        durationSeconds: t.durationSeconds ?? 120,
        needsApproval: t.needsApproval ?? true,
        blocker: t.blocker ?? null,
        createdAt: now - 3 * HOUR,
        updatedAt: now,
        startedAt: t.status === 'backlog' ? null : now - 30 * MINUTE,
        completedAt: t.completedAgo ? now - t.completedAgo : null,
      });
      taskByKey.set(t.key, task);

      // An agent only holds a task that is still live. Completed work is history.
      if (agent && t.status !== 'completed') {
        repos.agents.update(agent.id, { currentTaskId: task.id, progress, updatedAt: now });
        agentByKey.set(t.agent!, { ...agent, currentTaskId: task.id, progress });
      }

      // Delivered work is crated at the project it belongs to.
      if (t.status === 'completed') repos.projects.addCrate(project.id);
    }

    // ── The approval that is already waiting for you ────────────────────────
    const waiting = SEED_TASKS.find((t) => t.status === 'waiting_approval');
    if (waiting?.agent) {
      const task = taskByKey.get(waiting.key);
      const agent = agentByKey.get(waiting.agent);
      if (task && agent) {
        repos.approvals.create(
          buildApprovalRequest({
            id: newId('apr'),
            taskId: task.id,
            agentId: agent.id,
            summary: `${agent.name} finished “${task.title}” and needs your sign-off before it is delivered.`,
            category: 'deliverable',
            action: `Deliver “${task.title}”`,
            reason: 'The work is finished and this task was marked as needing your sign-off.',
            impact: 'Approving delivers the work and completes the task.',
            requestedAt: now - 12 * MINUTE,
          }),
        );
      }
    }

    // ── A little history, so the log is not empty on first load ─────────────
    const history: { eventType: ActivityEventType; message: string; task: string; ago: number }[] = [
      { eventType: 'delivered', message: 'Nova delivered “Build the source library” to the Delivery Depot', task: 'source-library', ago: 5 * HOUR },
      { eventType: 'delivered', message: 'Excel Expert delivered “FY25 cost baseline” to the Delivery Depot', task: 'cost-baseline', ago: 20 * HOUR },
      { eventType: 'blocked', message: 'Forge reported a blocker on “Fix the checkout regression”', task: 'checkout', ago: 38 * MINUTE },
      { eventType: 'approval_requested', message: 'Nova finished “Competitor landscape scan” and is waiting for your approval', task: 'competitors', ago: 12 * MINUTE },
      { eventType: 'paused', message: '“Launch deck: storyline and slides” was paused at 61% — progress held', task: 'launch-deck', ago: 26 * MINUTE },
      { eventType: 'started', message: 'Atlas started “Break the launch into workstreams”', task: 'breakdown', ago: 22 * MINUTE },
    ];

    for (const h of history) {
      const task = taskByKey.get(h.task);
      if (!task) continue;
      const event: ActivityEvent = {
        id: newId('evt'),
        projectId: task.projectId,
        agentId: task.assignedAgentId,
        taskId: task.id,
        eventType: h.eventType,
        message: h.message,
        timestamp: now - h.ago,
      };
      repos.activity.create(event);
    }

    return {
      projects: repos.projects.list(),
      agents: repos.agents.list(),
      tasks: repos.tasks.list(),
    };
  });
}

/** True when the world has never been seeded. */
export function isEmptyWorld(repos: Repositories): boolean {
  return repos.projects.list().length === 0;
}
