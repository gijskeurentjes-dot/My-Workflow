import {
  BOT_PROFILES,
  ISLAND_DEFS,
  TASK_TYPES,
  type ActivityEvent,
  type ActivityKind,
  type Bot,
  type BotKey,
  type Island,
  type IslandKey,
  type Project,
  type Task,
  type TaskType,
} from '@ai-islands/shared';
import { newId } from '../ids.js';
import type { Repositories } from '../repositories/types.js';

/**
 * The demo world.
 *
 * It is written to show every state at a glance: someone working, someone
 * waiting on you, someone blocked, someone paused and someone idle. The
 * "reset demo data" action replays exactly this.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface SeedTask {
  key: string;
  project: string;
  title: string;
  notes: string;
  type: TaskType;
  status: Task['status'];
  bot: BotKey | null;
  progress?: number;
  durationSeconds?: number;
  needsApproval?: boolean;
  blocker?: string;
  /** How long ago it was completed, in ms. Only for completed tasks. */
  completedAgo?: number;
}

const SEED_PROJECTS: { key: string; name: string; goal: string; color: string }[] = [
  {
    key: 'launch',
    name: 'Q4 Product Launch',
    goal: 'Ship the new pricing page and launch deck before the quarter closes.',
    color: '#f4834f',
  },
  {
    key: 'research',
    name: 'Market Research Refresh',
    goal: 'Understand where we sit against the three closest competitors.',
    color: '#7a63d8',
  },
  {
    key: 'budget',
    name: 'FY26 Budget',
    goal: 'Build a defensible baseline and a lean scenario.',
    color: '#3aa85f',
  },
];

const SEED_TASKS: SeedTask[] = [
  // ── Someone is working ────────────────────────────────────────────────────
  {
    key: 'breakdown',
    project: 'launch',
    title: 'Break the launch into workstreams',
    notes: 'Sequence the pricing page, the deck and the revenue model.',
    type: 'planning',
    status: 'working',
    bot: 'atlas',
    progress: 44,
    durationSeconds: 150,
  },
  {
    key: 'revenue-model',
    project: 'budget',
    title: 'Q4 revenue model',
    notes: 'Base, upside and downside cases with the assumptions labelled.',
    type: 'analysis',
    status: 'working',
    bot: 'excel-expert',
    progress: 27,
    durationSeconds: 135,
  },

  // ── Someone needs you ─────────────────────────────────────────────────────
  {
    key: 'competitors',
    project: 'research',
    title: 'Competitor landscape scan',
    notes: 'Pricing tiers, positioning and recent launches for the top three.',
    type: 'research',
    status: 'waiting_approval',
    bot: 'nova',
    progress: 100,
    durationSeconds: 120,
  },

  // ── Someone is blocked ────────────────────────────────────────────────────
  {
    key: 'checkout',
    project: 'launch',
    title: 'Fix the checkout regression',
    notes: 'Card payments fail on the annual plan after the pricing change.',
    type: 'coding',
    status: 'failed',
    bot: 'forge',
    progress: 38,
    durationSeconds: 130,
    blocker: 'The staging payment gateway is rejecting test cards — needs a credential from you.',
  },

  // ── Someone is paused ─────────────────────────────────────────────────────
  {
    key: 'launch-deck',
    project: 'launch',
    title: 'Launch deck: storyline and slides',
    notes: 'Twelve slides, speaker notes, one chart per claim.',
    type: 'writing',
    status: 'paused',
    bot: 'slidebuilder',
    progress: 61,
    durationSeconds: 140,
  },

  // ── Waiting on the board ──────────────────────────────────────────────────
  {
    key: 'pricing-page',
    project: 'launch',
    title: 'Build the new pricing page',
    notes: 'Three tiers, annual toggle, and the comparison table.',
    type: 'coding',
    status: 'backlog',
    bot: null,
  },
  {
    key: 'interviews',
    project: 'research',
    title: 'Summarise the customer interviews',
    notes: 'Nine transcripts. Pull the themes and the direct quotes.',
    type: 'research',
    status: 'backlog',
    bot: null,
  },
  {
    key: 'budget-deck',
    project: 'budget',
    title: 'Budget review deck',
    notes: 'One slide per cost centre with the variance called out.',
    type: 'writing',
    status: 'backlog',
    bot: null,
  },
  {
    key: 'launch-review',
    project: 'launch',
    title: 'Review the launch checklist',
    notes: 'Everything that has to be true before we announce.',
    type: 'review',
    status: 'backlog',
    bot: null,
  },

  // ── Already delivered ─────────────────────────────────────────────────────
  {
    key: 'source-library',
    project: 'research',
    title: 'Build the source library',
    notes: 'Every source tagged, de-duplicated and dated.',
    type: 'research',
    status: 'completed',
    bot: 'nova',
    progress: 100,
    completedAgo: 5 * HOUR,
  },
  {
    key: 'cost-baseline',
    project: 'budget',
    title: 'FY25 cost baseline',
    notes: 'Actuals by cost centre, reconciled to the ledger.',
    type: 'analysis',
    status: 'completed',
    bot: 'excel-expert',
    progress: 100,
    completedAgo: 20 * HOUR,
  },
];

/** Where a bot stands, given what it is doing. */
function plotForStatus(status: Bot['status']): Bot['locationKey'] {
  switch (status) {
    case 'working':
    case 'failed':
      return 'workbench';
    case 'waiting_approval':
      return 'approval';
    case 'paused':
      return 'workbench';
    default:
      return 'rest';
  }
}

export interface SeedResult {
  islands: Island[];
  bots: Bot[];
  projects: Project[];
  tasks: Task[];
}

/**
 * Write the demo world. Assumes the tables are empty — callers that are
 * resetting should clear them first via `repositories.reset()`.
 */
export function seedWorld(repos: Repositories, now: number = Date.now()): SeedResult {
  return repos.transaction(() => {
    // ── Islands ─────────────────────────────────────────────────────────────
    const islandByKey = new Map<IslandKey, Island>();
    for (const def of ISLAND_DEFS) {
      const island = repos.islands.create({
        id: newId('isl'),
        key: def.key,
        name: def.name,
        blurb: def.blurb,
        biome: def.biome,
        seed: def.seed,
        layout: def.layout,
        crates: 0,
        createdAt: now,
      });
      islandByKey.set(def.key, island);
    }

    // ── Projects ────────────────────────────────────────────────────────────
    const projectByKey = new Map<string, Project>();
    for (const p of SEED_PROJECTS) {
      const project = repos.projects.create({
        id: newId('prj'),
        name: p.name,
        goal: p.goal,
        status: 'active',
        color: p.color,
        createdAt: now - 2 * HOUR,
        updatedAt: now,
      });
      projectByKey.set(p.key, project);
    }

    // ── Bots ────────────────────────────────────────────────────────────────
    // Status is decided by the task each bot is holding, so the two can never
    // disagree. Bots with no seeded task start idle at the rest point.
    const statusByBot = new Map<BotKey, Bot['status']>();
    for (const t of SEED_TASKS) {
      if (!t.bot) continue;
      if (t.status === 'working') statusByBot.set(t.bot, 'working');
      else if (t.status === 'waiting_approval') statusByBot.set(t.bot, 'waiting_approval');
      else if (t.status === 'failed') statusByBot.set(t.bot, 'failed');
      else if (t.status === 'paused') statusByBot.set(t.bot, 'paused');
    }

    const botByKey = new Map<BotKey, Bot>();
    for (const profile of Object.values(BOT_PROFILES)) {
      const island = islandByKey.get(profile.homeIsland);
      if (!island) throw new Error(`Seed: no island for ${profile.homeIsland}`);

      const status = statusByBot.get(profile.key) ?? 'idle';
      const bot = repos.bots.create({
        id: newId('bot'),
        key: profile.key,
        name: profile.name,
        islandId: island.id,
        status,
        taskId: null, // linked below, once the tasks exist
        locationKey: plotForStatus(status),
        movement: null,
        progress: 0,
        updatedAt: now,
      });
      botByKey.set(profile.key, bot);
    }

    // ── Tasks ───────────────────────────────────────────────────────────────
    const tasks: Task[] = [];
    const taskByKey = new Map<string, Task>();

    for (const t of SEED_TASKS) {
      const project = projectByKey.get(t.project);
      const island = islandByKey.get(TASK_TYPES[t.type].island);
      if (!project || !island) throw new Error(`Seed: bad task ${t.key}`);

      const bot = t.bot ? botByKey.get(t.bot) : null;
      const progress = t.progress ?? 0;
      const started = t.status === 'backlog' ? null : now - 30 * MINUTE;

      const task = repos.tasks.create({
        id: newId('tsk'),
        projectId: project.id,
        title: t.title,
        notes: t.notes,
        type: t.type,
        status: t.status,
        islandId: island.id,
        botId: bot?.id ?? null,
        progress,
        durationSeconds: t.durationSeconds ?? 120,
        needsApproval: t.needsApproval ?? true,
        blocker: t.blocker ?? null,
        createdAt: now - 3 * HOUR,
        startedAt: started,
        completedAt: t.completedAgo ? now - t.completedAgo : null,
      });
      tasks.push(task);
      taskByKey.set(t.key, task);

      // A bot only holds a task that is still live. Completed work is history.
      if (bot && t.status !== 'completed') {
        repos.bots.update(bot.id, { taskId: task.id, progress });
        botByKey.set(bot.key, { ...bot, taskId: task.id, progress });
      }

      // Delivered work is crated at the island it was done on.
      if (t.status === 'completed') {
        repos.islands.addCrate(island.id);
      }
    }

    // ── The approval that is already waiting for you ────────────────────────
    const waiting = SEED_TASKS.find((t) => t.status === 'waiting_approval');
    if (waiting && waiting.bot) {
      const task = taskByKey.get(waiting.key);
      const bot = botByKey.get(waiting.bot);
      if (task && bot) {
        repos.approvals.create({
          id: newId('apr'),
          taskId: task.id,
          botId: bot.id,
          summary: `${bot.name} finished “${task.title}” and needs your sign-off before it is delivered.`,
          status: 'pending',
          requestedAt: now - 12 * MINUTE,
          decidedAt: null,
          note: null,
        });
      }
    }

    // ── A little history, so the log is not empty on first load ─────────────
    const history: { kind: ActivityKind; message: string; task: string; ago: number }[] = [
      { kind: 'delivered', message: 'Nova delivered “Build the source library” to the depot', task: 'source-library', ago: 5 * HOUR },
      { kind: 'delivered', message: 'Excel Expert delivered “FY25 cost baseline” to the depot', task: 'cost-baseline', ago: 20 * HOUR },
      { kind: 'blocked', message: 'Forge reported a blocker on “Fix the checkout regression”', task: 'checkout', ago: 38 * MINUTE },
      { kind: 'approval_requested', message: 'Nova finished “Competitor landscape scan” and is waiting for your approval', task: 'competitors', ago: 12 * MINUTE },
      { kind: 'paused', message: 'Launch deck was paused at 61% — progress held', task: 'launch-deck', ago: 26 * MINUTE },
      { kind: 'started', message: 'Atlas started “Break the launch into workstreams”', task: 'breakdown', ago: 22 * MINUTE },
    ];

    for (const h of history) {
      const task = taskByKey.get(h.task);
      if (!task) continue;
      const event: ActivityEvent = {
        id: newId('evt'),
        kind: h.kind,
        message: h.message,
        projectId: task.projectId,
        taskId: task.id,
        botId: task.botId,
        islandId: task.islandId,
        at: now - h.ago,
      };
      repos.activity.create(event);
    }

    return {
      islands: repos.islands.list(),
      bots: repos.bots.list(),
      projects: repos.projects.list(),
      tasks: repos.tasks.list(),
    };
  });
}

/** True when the world has never been seeded. */
export function isEmptyWorld(repos: Repositories): boolean {
  return repos.islands.list().length === 0;
}
