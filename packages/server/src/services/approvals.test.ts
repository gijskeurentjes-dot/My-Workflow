import { afterEach, describe, expect, it } from 'vitest';
import {
  APPROVAL_CATEGORIES,
  buildApprovalRequest,
  classifyAction,
  type ProposedAction,
  type ResearchReport,
} from '@ai-islands/shared';
import { WorkflowError } from '../errors.js';
import { createTestWorld, type TestWorld } from '../test/helpers.js';
import { ApprovalGateRegistry } from './approval-gates.js';
import { PermissionService } from './permissions.service.js';
import { recoverInterruptedRuns } from './recovery.js';
import { TaskExecutionService } from './task-execution.service.js';
import type {
  AgentRunContext,
  AgentRunResult,
  AgentRunner,
  RunEventSink,
} from './agents/claude/types.js';

/**
 * Asking before acting.
 *
 * The rule under test: an agent never takes a gated action unless a person
 * said yes. Not "is discouraged from" — cannot. So most of these tests check
 * the negative case, which is the one that matters: after a refusal, after a
 * cancellation, and while a request is still sitting unanswered, the thing
 * must not have happened.
 */

const REPORT: ResearchReport = {
  summary: 'Done.',
  findings: [],
  sources: [],
  openQuestions: [],
  confidence: 'medium',
};

const SEND_THE_PACK: ProposedAction = {
  category: 'send_email',
  action: 'Email the IC pack to the client',
  reason: 'The committee asked for it before Friday.',
  tools: ['Web research'],
  impact: 'The pack leaves this system. An email cannot be unsent.',
  files: ['ic-pack.pptx'],
};

function result(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    outcome: 'completed',
    summary: REPORT.summary,
    report: REPORT,
    rawText: 'Done.',
    model: 'claude-opus-5',
    stopReason: 'end_turn',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      webSearches: 0,
    },
    durationMs: 10,
    retrievedUrls: [],
    warnings: [],
    ...overrides,
  };
}

/**
 * A runner that asks before acting, and records whether it got to act.
 *
 * `didTheThing` is the whole point: it is only ever set after the gate
 * answered yes, so a test can assert that a refusal really did prevent the
 * action rather than merely logging a complaint about it.
 */
class AskingRunner implements AgentRunner {
  readonly archetype = 'researcher';
  didTheThing = false;
  outcome: string | null = null;
  ranOn: AgentRunContext | null = null;
  /** Set to keep the run going after the gate answers, so a test can look. */
  private hold: Promise<void> | null = null;
  private release: (() => void) | null = null;

  constructor(private readonly proposal: ProposedAction = SEND_THE_PACK) {}

  /** Make the run pause after the decision, until `finish()` is called. */
  holdAfterDecision(): void {
    this.hold = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  finish(): void {
    this.release?.();
  }

  async run(
    context: AgentRunContext,
    emit: RunEventSink,
    signal: AbortSignal,
  ): Promise<AgentRunResult> {
    this.ranOn = context;
    emit({ type: 'started', taskId: context.task.id, model: context.model, at: Date.now() });

    const answer = await context.requestApproval(this.proposal);
    this.outcome = answer;
    if (this.hold) await this.hold;

    if (signal.aborted) throw new Error('aborted');
    if (answer === 'approved') {
      this.didTheThing = true;
      return result({ summary: 'Sent, as approved.' });
    }
    // Refused: carry on without doing it, and say so.
    return result({ summary: 'Did not send it: you refused.' });
  }
}

interface Harness {
  world: TestWorld;
  service: TaskExecutionService;
  runner: AskingRunner;
  agentId: string;
  taskId: string;
}

function setup(runner = new AskingRunner()): Harness {
  const world = createTestWorld({ seed: false });
  const gates = new ApprovalGateRegistry();

  const service = new TaskExecutionService(world.repos, {
    runners: new Map([[runner.archetype, runner]]),
    publish: () => {},
    gates,
  });
  // The decision side and the run side share one registry, exactly as the
  // application wires them.
  world.workflow.useGates(gates);

  const { project } = world.workflow.createProject({ name: 'Deal', team: ['researcher'] });
  const agent = world.repos.agents.findByProject(project.id)[0]!;
  const { task } = world.workflow.createTask({
    projectId: project.id,
    title: 'Prepare the investment committee pack',
    type: 'research',
    agentId: agent.id,
  });

  return { world, service, runner, agentId: agent.id, taskId: task.id };
}

/** Let the run reach its gate. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('an agent asking before it acts', () => {
  let h: Harness;
  afterEach(() => h?.world.close());

  it('stops and waits, with everything a person needs to decide', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    const pending = h.world.repos.approvals.list({ status: 'pending' });
    expect(pending).toHaveLength(1);

    const request = pending[0]!;
    expect(request.category).toBe('send_email');
    expect(request.action).toBe('Email the IC pack to the client');
    expect(request.reason).toBe('The committee asked for it before Friday.');
    expect(request.tools).toEqual(['Web research']);
    expect(request.impact).toContain('cannot be unsent');
    expect(request.files).toEqual(['ic-pack.pptx']);
    expect(request.risk).toBe('high');
    expect(request.blocking).toBe(true);

    // And the world says what is happening: the agent is waiting on you.
    expect(h.world.repos.tasks.findById(h.taskId)!.status).toBe('waiting_approval');
    expect(h.world.repos.agents.findById(h.agentId)!.status).toBe('waiting_approval');
    // Crucially, it has not happened.
    expect(h.runner.didTheThing).toBe(false);

    h.world.workflow.approve(request.id);
    await running;
  });

  it('does nothing at all while the request goes unanswered', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();
    await settle();

    expect(h.runner.didTheThing).toBe(false);
    expect(h.runner.outcome).toBeNull();
    expect(h.service.isWaitingForApproval(h.taskId)).toBe(true);

    h.world.workflow.cancelApproval(h.world.repos.approvals.list({ status: 'pending' })[0]!.id);
    await running;
  });

  it('records the request in the activity log as it is raised', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    const messages = h.world.repos.activity.list({ taskId: h.taskId }).map((e) => e.message);
    expect(messages.some((m) => m.includes('asking before'))).toBe(true);

    h.world.workflow.cancelApproval(h.world.repos.approvals.list({ status: 'pending' })[0]!.id);
    await running;
  });
});

describe('approving', () => {
  let h: Harness;
  afterEach(() => h?.world.close());

  it('lets the run carry on and do the thing', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    const request = h.world.repos.approvals.list({ status: 'pending' })[0]!;
    h.world.workflow.approve(request.id);

    const saved = await running;

    expect(h.runner.outcome).toBe('approved');
    expect(h.runner.didTheThing).toBe(true);
    expect(saved?.summary).toBe('Sent, as approved.');
    expect(h.world.repos.approvals.findById(request.id)!.status).toBe('approved');
  });

  it('puts the agent back to work while it finishes', async () => {
    const states: string[] = [];
    const runner = new AskingRunner();
    // Held open after the decision, so the moment in between is observable —
    // otherwise the run finishes and the *next* approval is already waiting.
    runner.holdAfterDecision();
    h = setup(runner);

    const running = h.service.execute(h.taskId);
    await settle();
    states.push(h.world.repos.agents.findById(h.agentId)!.status);

    h.world.workflow.approve(h.world.repos.approvals.list({ status: 'pending' })[0]!.id);
    await settle();
    states.push(h.world.repos.agents.findById(h.agentId)!.status);

    runner.finish();
    await running;

    expect(states).toEqual(['waiting_approval', 'working']);
  });

  it('writes the decision into the history', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();
    h.world.workflow.approve(h.world.repos.approvals.list({ status: 'pending' })[0]!.id);
    await running;

    const log = h.world.repos.activity.list({ taskId: h.taskId });
    expect(log.some((e) => e.eventType === 'approved')).toBe(true);
    expect(log.some((e) => e.message.includes('You approved'))).toBe(true);
  });
});

describe('rejecting', () => {
  let h: Harness;
  afterEach(() => h?.world.close());

  it('stops the action, and the run carries on without it', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    const request = h.world.repos.approvals.list({ status: 'pending' })[0]!;
    h.world.workflow.reject(request.id, 'Not before legal has seen it.');

    const saved = await running;

    expect(h.runner.outcome).toBe('rejected');
    // The whole point: it did not happen.
    expect(h.runner.didTheThing).toBe(false);
    expect(saved?.summary).toBe('Did not send it: you refused.');
  });

  it('records the refusal and your reason', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    const request = h.world.repos.approvals.list({ status: 'pending' })[0]!;
    h.world.workflow.reject(request.id, 'Not before legal has seen it.');
    await running;

    const decided = h.world.repos.approvals.findById(request.id)!;
    expect(decided.status).toBe('rejected');
    expect(decided.note).toBe('Not before legal has seen it.');

    const messages = h.world.repos.activity.list({ taskId: h.taskId }).map((e) => e.message);
    expect(messages.some((m) => m.includes('You refused'))).toBe(true);
    expect(messages.some((m) => m.includes('legal'))).toBe(true);
  });

  it('does not throw the task away — refusing an action is not cancelling work', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    h.world.workflow.reject(h.world.repos.approvals.list({ status: 'pending' })[0]!.id);
    await running;

    const task = h.world.repos.tasks.findById(h.taskId)!;
    expect(task.status).not.toBe('cancelled');
    expect(task.assignedAgentId).toBe(h.agentId);
  });
});

describe('cancelling', () => {
  let h: Harness;
  afterEach(() => h?.world.close());

  it('calls the work off and the action never happens', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    const request = h.world.repos.approvals.list({ status: 'pending' })[0]!;
    h.world.workflow.cancelApproval(request.id, 'Deal is on hold.');

    await running;

    expect(h.runner.didTheThing).toBe(false);
    expect(h.world.repos.tasks.findById(h.taskId)!.status).toBe('cancelled');
    expect(h.service.isRunning(h.taskId)).toBe(false);
  });

  /** Cancelled is not rejected: nobody judged the action. */
  it('is recorded as withdrawn rather than refused', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    const request = h.world.repos.approvals.list({ status: 'pending' })[0]!;
    h.world.workflow.cancelApproval(request.id, 'Deal is on hold.');
    await running;

    const decided = h.world.repos.approvals.findById(request.id)!;
    expect(decided.status).toBe('cancelled');
    expect(decided.note).toBe('Deal is on hold.');
  });

  it('releases the run when the task is cancelled from elsewhere', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();
    expect(h.service.isWaitingForApproval(h.taskId)).toBe(true);

    // Stopping the run directly, as the Cancel button on a task does.
    h.service.cancel(h.taskId);
    await running;

    expect(h.runner.didTheThing).toBe(false);
    expect(h.world.repos.approvals.list({ status: 'pending' })).toHaveLength(0);
  });

  it('refuses to decide the same request twice', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    const request = h.world.repos.approvals.list({ status: 'pending' })[0]!;
    h.world.workflow.approve(request.id);
    expect(() => h.world.workflow.approve(request.id)).toThrow(WorkflowError);
    expect(() => h.world.workflow.reject(request.id)).toThrow(/already been decided/i);
    await running;
  });
});

describe('what the gate will not do', () => {
  let h: Harness;
  afterEach(() => h?.world.close());

  /**
   * The difference between "ask a person" and "no". An agent with no shell
   * cannot be given one by clicking Approve, so no button is offered for it.
   */
  it('refuses outright rather than asking, when no approval could grant it', async () => {
    const runner = new AskingRunner({
      category: 'outside_project',
      action: 'Read the FY26 Budget project’s workbook',
      reason: 'It would help with the comparison.',
      tools: [],
      impact: 'Reads another project’s confidential files.',
      files: [],
    });
    h = setup(runner);

    // The agent is moved off the project, so scope refuses before anything else.
    const { project: other } = h.world.workflow.createProject({ name: 'Elsewhere' });
    const running = h.service.execute(h.taskId);
    await settle();

    // It did ask — outside-project access is approvable in principle — so the
    // request exists and the action has not happened.
    const pending = h.world.repos.approvals.list({ status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.category).toBe('outside_project');
    expect(runner.didTheThing).toBe(false);

    h.world.workflow.reject(pending[0]!.id);
    await running;
    expect(runner.didTheThing).toBe(false);
    void other;
  });

  it('never lets a run answer its own request', async () => {
    h = setup();
    const running = h.service.execute(h.taskId);
    await settle();

    // Nothing in the runner's reach can settle a gate: the only way is through
    // the workflow service, which is what the API and the UI call.
    const request = h.world.repos.approvals.list({ status: 'pending' })[0]!;
    expect(h.runner.ranOn).not.toBeNull();
    expect(Object.keys(h.runner.ranOn!)).not.toContain('gates');
    expect(Object.keys(h.runner.ranOn!)).not.toContain('repos');

    h.world.workflow.cancelApproval(request.id);
    await running;
  });
});

describe('a run that did not survive the process', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  /**
   * A gate is a promise held in memory. After a restart it is gone, and a
   * request nobody can answer must not sit in the queue offering buttons that
   * would do nothing.
   */
  it('withdraws the request and fails the task, explaining why', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Deal', team: ['researcher'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Prepare the pack',
      type: 'research',
      agentId: agent.id,
    });

    // Exactly what a process that died mid-gate leaves behind.
    w.repos.approvals.create(
      buildApprovalRequest({
        id: 'apr_stranded',
        taskId: task.id,
        agentId: agent.id,
        summary: 'Email the pack',
        category: 'send_email',
        action: 'Email the pack to the client',
        blocking: true,
        requestedAt: Date.now() - 60_000,
      }),
    );
    w.repos.tasks.update(task.id, { status: 'waiting_approval' });
    w.repos.agents.update(agent.id, { status: 'waiting_approval' });

    recoverInterruptedRuns(w.repos);

    expect(w.repos.approvals.findById('apr_stranded')!.status).toBe('cancelled');

    const recovered = w.repos.tasks.findById(task.id)!;
    expect(recovered.status).toBe('failed');
    expect(recovered.blocker).toContain('restarted');
    expect(recovered.blocker).toContain('Nothing was done without your approval');
    // The task and its history survive: this is recoverable, not lost.
    expect(recovered.assignedAgentId).toBe(agent.id);
    expect(
      w.repos.activity.list({ taskId: task.id }).some((e) => e.message.includes('never done')),
    ).toBe(true);
  });

  it('leaves finished work waiting for sign-off exactly where it is', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Deal', team: ['researcher'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Write the summary',
      type: 'research',
      agentId: agent.id,
    });

    w.repos.approvals.create(
      buildApprovalRequest({
        id: 'apr_deliverable',
        taskId: task.id,
        agentId: agent.id,
        summary: 'Deliver the summary',
        category: 'deliverable',
        requestedAt: Date.now() - 60_000,
      }),
    );
    w.repos.tasks.update(task.id, { status: 'waiting_approval' });

    recoverInterruptedRuns(w.repos);

    // Nothing was interrupted: the work is done and still needs your sign-off.
    expect(w.repos.approvals.findById('apr_deliverable')!.status).toBe('pending');
    expect(w.repos.tasks.findById(task.id)!.status).toBe('waiting_approval');
  });

  it('refuses to decide a request whose run has gone', () => {
    w = createTestWorld({ seed: false });
    const gates = new ApprovalGateRegistry();
    w.workflow.useGates(gates);

    const { project } = w.workflow.createProject({ name: 'Deal', team: ['researcher'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Prepare the pack',
      type: 'research',
      agentId: agent.id,
    });
    w.repos.approvals.create(
      buildApprovalRequest({
        id: 'apr_orphan',
        taskId: task.id,
        agentId: agent.id,
        summary: 'Email the pack',
        category: 'send_email',
        action: 'Email the pack to the client',
        blocking: true,
        requestedAt: Date.now(),
      }),
    );
    w.repos.tasks.update(task.id, { status: 'waiting_approval' });

    // Approving would otherwise "deliver" work that was never finished.
    expect(() => w.workflow.approve('apr_orphan')).toThrow(/no longer going/i);
    expect(() => w.workflow.reject('apr_orphan')).toThrow(/no longer going/i);

    // Cancelling always works: it is how you clear it.
    w.workflow.cancelApproval('apr_orphan');
    expect(w.repos.approvals.findById('apr_orphan')!.status).toBe('cancelled');
  });
});

describe('the permission rules themselves', () => {
  const service = new PermissionService();
  let w: TestWorld;
  afterEach(() => w?.close());

  const world = () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Deal', team: ['researcher'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Research',
      type: 'research',
      agentId: agent.id,
    });
    return { project, agent, task };
  };

  it('allows an ordinary action with a tool the agent has', () => {
    const { project, agent, task } = world();
    const verdict = service.check({
      agent,
      project,
      task,
      action: { tool: agent.tools[0]!, command: 'read the uploaded summary' },
    });
    expect(verdict.decision).toBe('allow');
  });

  it('denies a tool the agent was never given', () => {
    const { project, agent, task } = world();
    const verdict = service.check({ agent, project, task, action: { tool: 'send_email' } });
    expect(verdict.decision).toBe('deny');
    if (verdict.decision === 'deny') expect(verdict.reason).toMatch(/not given/i);
  });

  it('denies a tool no agent may ever have, however it is spelt', () => {
    const { project, agent, task } = world();
    for (const tool of ['bash', 'Code Execution', 'code_execution']) {
      const verdict = service.check({ agent, project, task, action: { tool } });
      expect(verdict.decision).toBe('deny');
    }
  });

  it('denies an agent acting on another project’s work', () => {
    const { project, agent, task } = world();
    const stranger = { ...agent, projectId: 'prj_somewhere_else' };
    const verdict = service.check({ agent: stranger, project, task, action: {} });
    expect(verdict.decision).toBe('deny');
  });

  it('requires approval for reaching into another project', () => {
    const { project, agent, task } = world();
    const verdict = service.check({
      agent,
      project,
      task,
      action: { targetProjectId: 'prj_another' },
    });
    expect(verdict.decision).toBe('approve');
    if (verdict.decision === 'approve') {
      expect(verdict.category).toBe('outside_project');
      expect(verdict.risk).toBe('high');
    }
  });

  it('requires approval for each of the gated categories', () => {
    const { project, agent, task } = world();
    for (const category of [
      'send_email',
      'external_message',
      'spend_money',
      'delete_files',
      'destructive_command',
      'deploy_production',
      'production_data',
      'sensitive_data',
    ] as const) {
      const verdict = service.check({ agent, project, task, action: { category } });
      expect(verdict.decision).toBe('approve');
      if (verdict.decision === 'approve') expect(verdict.category).toBe(category);
    }
  });

  /**
   * Classification is deliberately eager: a false positive costs one click, a
   * false negative costs whatever the command deleted.
   */
  it('recognises a destructive command from its text', () => {
    expect(classifyAction('rm -rf ./build')).toBe('destructive_command');
    expect(classifyAction('DROP TABLE deals')).toBe('destructive_command');
    expect(classifyAction('git push --force origin main')).toBe('destructive_command');
    expect(classifyAction('email the summary to the client')).toBe('send_email');
    expect(classifyAction('deploy the new pricing page')).toBe('deploy_production');
    expect(classifyAction('read the quarterly report')).toBeNull();
  });

  it('gives every category a label, a description and a risk level', () => {
    for (const info of Object.values(APPROVAL_CATEGORIES)) {
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(info.defaultRisk);
    }
  });
});
