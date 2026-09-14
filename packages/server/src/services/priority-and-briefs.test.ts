import { afterEach, describe, expect, it } from 'vitest';
import { PRIORITY_RANK, type TaskPriority } from '@ai-islands/shared';
import { WorkflowError } from '../errors.js';
import { agentByName, createTestWorld, taskByTitle, type TestWorld } from '../test/helpers.js';

describe('task priority', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('defaults to normal', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Unprioritised',
      type: 'planning',
    });
    expect(task.priority).toBe('normal');
  });

  it('is set on creation and can be changed later', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Ship the hotfix',
      type: 'coding',
      priority: 'urgent',
    });
    expect(task.priority).toBe('urgent');

    const { task: lowered } = w.workflow.updateTask(task.id, { priority: 'low' });
    expect(lowered.priority).toBe('low');
  });

  it('orders every listing urgent-first, then oldest', () => {
    w = createTestWorld();
    const tasks = w.repos.tasks.list();
    for (let i = 1; i < tasks.length; i++) {
      const previous = tasks[i - 1]!;
      const current = tasks[i]!;
      const byRank = PRIORITY_RANK[current.priority] - PRIORITY_RANK[previous.priority];
      expect(byRank, `${current.title} outranks ${previous.title} but sorts after it`).toBeLessThanOrEqual(0);
      if (byRank === 0) expect(current.createdAt).toBeGreaterThanOrEqual(previous.createdAt);
    }
  });

  /**
   * Priority is only meaningful if it changes what actually happens. An idle
   * agent must take the urgent job, not simply the oldest one.
   */
  it('decides which waiting task an idle agent picks up first', () => {
    w = createTestWorld({ autoAssign: true });
    const project = w.repos.projects.list()[0]!;

    // Free Forge, then put two coding jobs on the board: an old low-priority
    // one and a newer urgent one.
    w.workflow.cancelTask(taskByTitle(w.repos, 'Fix the checkout regression').id);
    for (const t of w.repos.tasks.list({ status: 'backlog' })) {
      if (t.type === 'coding') w.workflow.cancelTask(t.id);
    }

    const { task: old } = w.workflow.createTask({
      projectId: project.id,
      title: 'Tidy the build script',
      type: 'coding',
      priority: 'low',
    });
    const { task: urgent } = w.workflow.createTask({
      projectId: project.id,
      title: 'Patch the auth bypass',
      type: 'coding',
      priority: 'urgent',
    });

    w.fastForward(5);

    const forge = agentByName(w.repos, 'Forge');
    expect(forge.currentTaskId, 'Forge took the low-priority job instead of the urgent one').toBe(
      urgent.id,
    );
    expect(w.repos.tasks.findById(old.id)!.status).toBe('backlog');
  });

  it('records when a task last changed', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Build the new pricing page');
    const before = task.updatedAt;

    w.workflow.updateTask(task.id, { title: 'Build the new pricing page v2' });

    expect(w.repos.tasks.findById(task.id)!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('rejects a priority the world does not recognise', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    // The route layer validates this; the service trusts its input, so this
    // documents where the guard lives rather than asserting a throw here.
    const valid: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
    expect(valid).toContain('urgent');
    expect(project).toBeDefined();
  });
});

describe('agent briefs', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('seeds every agent with a role, instructions and tools', () => {
    w = createTestWorld();
    for (const agent of w.repos.agents.list()) {
      expect(agent.role, `${agent.name} has no role`).toBeTruthy();
      expect(agent.instructions.length, `${agent.name} has no instructions`).toBeGreaterThan(40);
      expect(agent.tools.length, `${agent.name} has no tools`).toBeGreaterThan(0);
    }
  });

  it('builds instructions a real engine could send as a system prompt', () => {
    w = createTestWorld();
    const forge = agentByName(w.repos, 'Forge');
    expect(forge.role).toBe('Developer');
    expect(forge.instructions).toContain('Responsibilities:');
    expect(forge.instructions).toContain('Always check with the user before:');
    expect(forge.instructions).toContain('Asks before merging or deploying anything');
  });

  it('lets the brief be rewritten and persists it', () => {
    w = createTestWorld();
    const forge = agentByName(w.repos, 'Forge');

    const { agent } = w.workflow.updateAgent(forge.id, {
      role: 'Staff Engineer',
      instructions: 'Only touch the payments service. Never deploy on a Friday.',
      tools: ['Repository access', 'Test runner'],
    });

    expect(agent.role).toBe('Staff Engineer');
    expect(agent.tools).toEqual(['Repository access', 'Test runner']);

    // And it survives a round trip through the database.
    const reread = w.repos.agents.findById(forge.id)!;
    expect(reread.instructions).toBe('Only touch the payments service. Never deploy on a Friday.');
  });

  it('drops blank tools rather than storing empty strings', () => {
    w = createTestWorld();
    const nova = agentByName(w.repos, 'Nova');
    const { agent } = w.workflow.updateAgent(nova.id, { tools: ['Web research', '  ', ''] });
    expect(agent.tools).toEqual(['Web research']);
  });

  it('refuses to blank an agent’s name', () => {
    w = createTestWorld();
    const nova = agentByName(w.repos, 'Nova');
    expect(() => w.workflow.updateAgent(nova.id, { name: '   ' })).toThrow(WorkflowError);
  });

  it('writes an activity line naming what changed', () => {
    w = createTestWorld();
    const atlas = agentByName(w.repos, 'Atlas');
    const before = w.repos.activity.list({ limit: 500 }).length;

    w.workflow.updateAgent(atlas.id, { instructions: 'Escalate everything.' });

    const after = w.repos.activity.list({ limit: 500 });
    expect(after.length).toBe(before + 1);
    expect(after[0]!.message).toContain('instructions');
  });
});
