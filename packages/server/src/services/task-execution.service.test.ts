import { afterEach, describe, expect, it } from 'vitest';
import type { ResearchReport } from '@ai-islands/shared';
import { WorkflowError } from '../errors.js';
import { createTestWorld, type TestWorld } from '../test/helpers.js';
import { createFakeClient } from './agents/claude/fake-client.js';
import { ResearchRunner } from './agents/claude/research-runner.js';
import { TaskExecutionService } from './task-execution.service.js';
import type {
  AgentRunContext,
  AgentRunResult,
  AgentRunner,
  RunEvent,
  RunEventSink,
} from './agents/claude/types.js';

/**
 * The orchestration around a real run: who is allowed to start one, what the
 * board looks like while it is going, and what is left behind afterwards.
 *
 * Most tests here use a stub runner, because what is being checked is the
 * service's behaviour, not the model's. The last few use the real
 * `ResearchRunner` over a fake client so the two halves are known to fit.
 */

const REPORT: ResearchReport = {
  summary: 'Three competitors matter.',
  findings: [{ statement: 'Acme leads on price.', kind: 'fact', sourceUrls: ['https://acme.example'] }],
  sources: [{ title: 'Acme', url: 'https://acme.example', relevance: 'Pricing page.' }],
  openQuestions: [],
  confidence: 'medium',
};

/** A runner that does whatever the test needs, without touching a network. */
class StubRunner implements AgentRunner {
  readonly archetype = 'researcher';
  readonly seen: AgentRunContext[] = [];

  constructor(
    private readonly behaviour: (
      context: AgentRunContext,
      emit: RunEventSink,
      signal: AbortSignal,
    ) => Promise<AgentRunResult>,
  ) {}

  run(context: AgentRunContext, emit: RunEventSink, signal: AbortSignal): Promise<AgentRunResult> {
    this.seen.push(context);
    return this.behaviour(context, emit, signal);
  }
}

function successResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    outcome: 'completed',
    summary: REPORT.summary,
    report: REPORT,
    rawText: 'Three competitors matter.',
    model: 'claude-opus-5',
    stopReason: 'end_turn',
    usage: {
      inputTokens: 1200,
      outputTokens: 400,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      webSearches: 3,
    },
    durationMs: 900,
    retrievedUrls: ['https://acme.example'],
    warnings: [],
    ...overrides,
  };
}

interface Harness {
  world: TestWorld;
  service: TaskExecutionService;
  events: RunEvent[];
  agentId: string;
  projectId: string;
  taskId: string;
}

/** A project with Nova on it and one research task assigned to her. */
function setup(
  runner: AgentRunner | null,
  options: { needsApproval?: boolean } = {},
): Harness {
  const world = createTestWorld({ seed: false });
  const { project } = world.workflow.createProject({ name: 'Market research', team: ['researcher'] });
  const agent = world.repos.agents.findByProject(project.id)[0]!;

  const { task } = world.workflow.createTask({
    projectId: project.id,
    title: 'Research the top competitors in my market and create a summary',
    description: 'Mid-market SaaS, EU.',
    type: 'research',
    needsApproval: options.needsApproval ?? true,
    agentId: agent.id,
  });

  const events: RunEvent[] = [];
  const service = new TaskExecutionService(world.repos, {
    runners: runner ? new Map([[runner.archetype, runner]]) : new Map(),
    publish: () => {},
    onEvent: (event) => events.push(event),
  });

  return { world, service, events, agentId: agent.id, projectId: project.id, taskId: task.id };
}

describe('running a task for real', () => {
  let h: Harness;
  afterEach(() => h?.world.close());

  it('hands the agent its own brief, its project and its task', async () => {
    const runner = new StubRunner(async () => successResult());
    h = setup(runner);

    await h.service.execute(h.taskId);

    const context = runner.seen[0]!;
    expect(context.agent.id).toBe(h.agentId);
    expect(context.project.id).toBe(h.projectId);
    expect(context.task.id).toBe(h.taskId);
    expect(context.agent.instructions).toContain('research');
    expect(context.maxExecutionMs).toBeGreaterThan(0);
  });

  it('marks the task working while it runs, then waiting for approval', async () => {
    let statusDuringRun = '';
    const runner = new StubRunner(async () => {
      statusDuringRun = h.world.repos.tasks.findById(h.taskId)!.status;
      return successResult();
    });
    h = setup(runner, { needsApproval: true });

    await h.service.execute(h.taskId);

    expect(statusDuringRun).toBe('working');
    expect(h.world.repos.tasks.findById(h.taskId)!.status).toBe('waiting_approval');
    expect(h.world.repos.agents.findById(h.agentId)!.status).toBe('waiting_approval');
    expect(h.world.repos.approvals.list({ status: 'pending' })).toHaveLength(1);
  });

  it('delivers without asking when neither the task nor the agent needs sign-off', async () => {
    const runner = new StubRunner(async () => successResult());
    h = setup(runner, { needsApproval: false });
    h.world.repos.agents.update(h.agentId, { requiresApproval: false });

    await h.service.execute(h.taskId);

    expect(h.world.repos.tasks.findById(h.taskId)!.status).toBe('delivering');
    expect(h.world.repos.approvals.list({ status: 'pending' })).toHaveLength(0);
  });

  it('saves the result with what the run actually cost', async () => {
    const runner = new StubRunner(async () => successResult());
    h = setup(runner);

    const saved = await h.service.execute(h.taskId);

    expect(saved).not.toBeNull();
    const stored = h.world.repos.results.findLatestByTask(h.taskId)!;
    expect(stored.id).toBe(saved!.id);
    expect(stored.report?.summary).toBe(REPORT.summary);
    expect(stored.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 400,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      webSearches: 3,
    });
    expect(stored.model).toBe('claude-opus-5');
    expect(stored.durationMs).toBe(900);
  });

  it('writes an over-claimed source into the history rather than hiding it', async () => {
    const runner = new StubRunner(async () =>
      successResult({ warnings: ['Cited https://nowhere.example but never retrieved it.'] }),
    );
    h = setup(runner);

    await h.service.execute(h.taskId);

    const messages = h.world.repos.activity.list({ taskId: h.taskId }).map((e) => e.message);
    expect(messages.some((m) => m.includes('https://nowhere.example'))).toBe(true);
  });

  it('streams progress events out while the run is going', async () => {
    const runner = new StubRunner(async (context, emit) => {
      emit({ type: 'searching', taskId: context.task.id, query: 'competitors', at: Date.now() });
      return successResult();
    });
    h = setup(runner);

    await h.service.execute(h.taskId);

    expect(h.events.map((e) => e.type)).toContain('searching');
  });

  it('records a decline as a blocker you can read, not a crash', async () => {
    const runner = new StubRunner(async () =>
      successResult({
        outcome: 'refused',
        summary: 'Claude declined this request (cyber).',
        report: null,
      }),
    );
    h = setup(runner);

    await expect(h.service.execute(h.taskId)).resolves.not.toBeNull();

    const task = h.world.repos.tasks.findById(h.taskId)!;
    expect(task.status).toBe('failed');
    expect(task.blocker).toContain('declined');
    // The attempt is still on file — a refusal is evidence, not nothing.
    expect(h.world.repos.results.listByTask(h.taskId)).toHaveLength(1);
  });

  it('turns a failure into a readable blocker instead of an exception', async () => {
    const runner = new StubRunner(async () => {
      throw new Error('socket hang up');
    });
    h = setup(runner);

    const result = await h.service.execute(h.taskId);

    expect(result).toBeNull();
    const task = h.world.repos.tasks.findById(h.taskId)!;
    expect(task.status).toBe('failed');
    expect(task.blocker).toBe('socket hang up');
    expect(h.world.repos.agents.findById(h.agentId)!.status).toBe('failed');
  });

  it('stops an in-flight run when cancelled, and frees the agent', async () => {
    const runner = new StubRunner(
      (_context, _emit, signal) =>
        new Promise<AgentRunResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    h = setup(runner);

    const running = h.service.execute(h.taskId);
    // Let the runner start before pulling the plug.
    await Promise.resolve();
    expect(h.service.isRunning(h.taskId)).toBe(true);
    expect(h.service.cancel(h.taskId)).toBe(true);
    await running;

    const task = h.world.repos.tasks.findById(h.taskId)!;
    expect(task.status).toBe('cancelled');
    expect(task.assignedAgentId).toBeNull();
    expect(h.world.repos.agents.findById(h.agentId)!.status).toBe('idle');
    expect(h.service.isRunning(h.taskId)).toBe(false);
  });

  it('reports nothing to cancel when nothing is running', () => {
    h = setup(new StubRunner(async () => successResult()));
    expect(h.service.cancel(h.taskId)).toBe(false);
  });

  it('stops a run that overruns its own time limit', async () => {
    const runner = new StubRunner(
      (_context, _emit, signal) =>
        new Promise<AgentRunResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    h = setup(runner);
    h.world.repos.agents.update(h.agentId, { maxExecutionMs: 5 });

    await h.service.execute(h.taskId);

    const task = h.world.repos.tasks.findById(h.taskId)!;
    expect(task.status).toBe('failed');
    expect(task.blocker).toMatch(/limit/i);
  });

  it('refuses to start the same task twice', async () => {
    const runner = new StubRunner(
      (_context, _emit, signal) =>
        new Promise<AgentRunResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    h = setup(runner);

    const first = h.service.execute(h.taskId);
    await Promise.resolve();
    await expect(h.service.execute(h.taskId)).rejects.toThrow(WorkflowError);

    h.service.cancel(h.taskId);
    await first;
  });
});

describe('what a run is not allowed to do', () => {
  let h: Harness;
  afterEach(() => h?.world.close());

  /**
   * The security list in the brief, enforced here rather than left to the
   * model's judgement: every one of these refusals happens before a single
   * token is spent.
   */
  it('refuses an agent whose brief lists a tool that can touch this machine', async () => {
    const runner = new StubRunner(async () => successResult());
    h = setup(runner);
    h.world.repos.agents.update(h.agentId, { tools: ['web_search', 'bash'] });

    await expect(h.service.execute(h.taskId)).rejects.toThrow(/bash/i);
    expect(runner.seen).toHaveLength(0);
    expect(h.world.repos.tasks.findById(h.taskId)!.status).not.toBe('working');
  });

  it('catches a forbidden tool however it is spelt', async () => {
    const runner = new StubRunner(async () => successResult());
    h = setup(runner);
    h.world.repos.agents.update(h.agentId, { tools: ['Code Execution'] });

    await expect(h.service.execute(h.taskId)).rejects.toThrow(WorkflowError);
    expect(runner.seen).toHaveLength(0);
  });

  it('hands the model only web search, whatever else the brief claims', async () => {
    const runner = new StubRunner(async () => successResult());
    h = setup(runner);
    h.world.repos.agents.update(h.agentId, { tools: ['web_search', 'send_email', 'crm'] });

    await h.service.execute(h.taskId);

    expect(runner.seen[0]!.tools).toEqual(['web_search']);
  });

  it('refuses an agent working on somebody else’s project', async () => {
    const runner = new StubRunner(async () => successResult());
    h = setup(runner);
    const { project: other } = h.world.workflow.createProject({ name: 'Unrelated', team: ['pm'] });
    h.world.repos.agents.update(h.agentId, { projectId: other.id });

    await expect(h.service.execute(h.taskId)).rejects.toThrow(/not on/i);
    expect(runner.seen).toHaveLength(0);
  });

  it('refuses an archetype with no live engine', async () => {
    h = setup(new StubRunner(async () => successResult()));
    const { agent } = h.world.workflow.hireAgent(h.projectId, 'developer', 'Forge');
    h.world.workflow.assignTask(h.taskId, agent.id);

    await expect(h.service.execute(h.taskId)).rejects.toThrow(/Researcher/i);
  });

  it('refuses an unassigned task', async () => {
    h = setup(new StubRunner(async () => successResult()));
    h.world.workflow.unassignTask(h.taskId);
    await expect(h.service.execute(h.taskId)).rejects.toThrow(/Assign an agent/i);
  });

  it('knows which tasks it could run at all', () => {
    h = setup(new StubRunner(async () => successResult()));
    expect(h.service.canExecute(h.taskId)).toBe(true);

    const { agent } = h.world.workflow.hireAgent(h.projectId, 'analyst', 'Tally');
    h.world.workflow.assignTask(h.taskId, agent.id);
    expect(h.service.canExecute(h.taskId)).toBe(false);
  });

  it('cannot run anything when no engine is configured at all', async () => {
    h = setup(null);
    expect(h.service.canExecute(h.taskId)).toBe(false);
    await expect(h.service.execute(h.taskId)).rejects.toThrow(WorkflowError);
  });
});

describe('the service and the real runner together', () => {
  let h: Harness;
  afterEach(() => h?.world.close());

  it('takes a task id and leaves a saved report behind', async () => {
    const { client } = createFakeClient({
      turns: [
        {
          text: 'Acme, Beta and Gamma lead the segment.',
          searches: [{ query: 'mid-market SaaS competitors EU', urls: [{ url: 'https://acme.example' }] }],
          usage: { input_tokens: 2000, output_tokens: 600 },
        },
      ],
      parsed: REPORT,
    });

    h = setup(new ResearchRunner(client));

    const saved = await h.service.execute(h.taskId);

    expect(saved).not.toBeNull();
    expect(saved!.report?.findings).toHaveLength(1);
    expect(saved!.usage.webSearches).toBe(1);
    expect(h.world.repos.tasks.findById(h.taskId)!.status).toBe('waiting_approval');
    expect(h.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['started', 'searching', 'structuring', 'finished']),
    );
  });

  it('records the API refusing, without losing the task', async () => {
    const { client } = createFakeClient({
      turns: [{ text: '', stopReason: 'refusal', refusalCategory: 'cyber' }],
    });

    h = setup(new ResearchRunner(client));
    await h.service.execute(h.taskId);

    const task = h.world.repos.tasks.findById(h.taskId)!;
    expect(task.status).toBe('failed');
    expect(task.blocker).toContain('cyber');
  });
});
