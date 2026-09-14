import { afterEach, describe, expect, it } from 'vitest';
import { ARCHETYPES, defaultInstructions } from '@ai-islands/shared';
import { WorkflowError } from '../errors.js';
import { agentByName, createTestWorld, taskByTitle, type TestWorld } from '../test/helpers.js';

/**
 * A project is an island with its own team. These tests cover the part of that
 * which is new: hiring onto a project, dismissing from one, and the fact that
 * teams stay separate.
 */
describe('project teams', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('gives a new project someone to work with', () => {
    w = createTestWorld();
    const { project } = w.workflow.createProject({ name: 'Website refresh' });

    // A project with nobody on it can never do anything.
    const team = w.repos.agents.findByProject(project.id);
    expect(team.length).toBeGreaterThan(0);
    expect(team[0]!.archetype).toBe('pm');
  });

  it('can be created with a chosen team', () => {
    w = createTestWorld();
    const { project } = w.workflow.createProject({
      name: 'Data platform',
      team: ['pm', 'developer', 'analyst'],
    });

    const team = w.repos.agents.findByProject(project.id);
    expect(team.map((a) => a.archetype).sort()).toEqual(['analyst', 'developer', 'pm']);
  });

  it('hires an agent onto an existing project with a usable brief', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    const before = w.repos.agents.findByProject(project.id).length;

    const { agent } = w.workflow.hireAgent(project.id, 'researcher', 'Beacon');

    expect(w.repos.agents.findByProject(project.id)).toHaveLength(before + 1);
    expect(agent.name).toBe('Beacon');
    expect(agent.role).toBe(ARCHETYPES.researcher.title);
    // The brief it starts with is the one a real engine would send.
    expect(agent.instructions).toBe(defaultInstructions(ARCHETYPES.researcher));
    expect(agent.tools.length).toBeGreaterThan(0);
    expect(agent.status).toBe('idle');
  });

  it('falls back to the archetype name when none is given', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    const { agent } = w.workflow.hireAgent(project.id, 'analyst');
    expect(agent.name).toBe(ARCHETYPES.analyst.defaultName);
  });

  it('refuses an archetype it does not have', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    // Cast past the type system the way a bad request would arrive.
    expect(() => w.workflow.hireAgent(project.id, 'wizard' as never)).toThrow(WorkflowError);
  });

  it('puts work back on the board when an agent is dismissed', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');
    const agentId = task.assignedAgentId!;

    w.workflow.dismissAgent(agentId);

    expect(w.repos.agents.findById(agentId)).toBeNull();
    const freed = w.repos.tasks.findById(task.id)!;
    expect(freed.status).toBe('backlog');
    expect(freed.assignedAgentId).toBeNull();
    // Progress is kept, so nothing is lost by a team change.
    expect(freed.progress).toBe(task.progress);
  });

  it('withdraws a pending approval when the agent holding it is dismissed', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Competitor landscape scan');
    expect(w.repos.approvals.findPendingByTask(task.id)).not.toBeNull();

    w.workflow.dismissAgent(task.assignedAgentId!);

    // Nobody is left to deliver it, so the request cannot stay in the queue.
    expect(w.repos.approvals.findPendingByTask(task.id)).toBeNull();
  });

  it('only offers a project its own team when starting unassigned work', () => {
    w = createTestWorld();
    // Nova is the researcher on her own project. Give a different project some
    // research to do, and its own researcher to do it.
    const nova = agentByName(w.repos, 'Nova');
    const otherProject = w.repos.projects.list().find((p) => p.id !== nova.projectId)!;
    const { agent: localResearcher } = w.workflow.hireAgent(
      otherProject.id,
      'researcher',
      'Beacon',
    );

    const { task } = w.workflow.createTask({
      projectId: otherProject.id,
      title: 'Find the benchmark data',
      type: 'research',
    });

    w.workflow.startTask(task.id);

    // Beacon takes it, not Nova — even though Nova is the obvious researcher.
    const started = w.repos.tasks.findById(task.id)!;
    expect(started.assignedAgentId).toBe(localResearcher.id);
    expect(started.assignedAgentId).not.toBe(nova.id);
  });

  it('refuses to start work when nobody on the project is free', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    // Occupy the whole team.
    for (const agent of w.repos.agents.findByProject(project.id)) {
      w.repos.agents.update(agent.id, { currentTaskId: 'busy' });
    }

    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Something nobody can take',
      type: 'planning',
    });

    expect(() => w.workflow.startTask(task.id)).toThrow(/hire|assign someone/i);
  });

  it('logs a hire and a dismissal against the project', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;

    const { agent } = w.workflow.hireAgent(project.id, 'developer', 'Anvil');
    const hired = w.repos.activity.list({ projectId: project.id, limit: 5 });
    expect(hired[0]!.eventType).toBe('hired');
    expect(hired[0]!.message).toContain('Anvil');

    w.workflow.dismissAgent(agent.id);
    const left = w.repos.activity.list({ projectId: project.id, limit: 5 });
    expect(left[0]!.eventType).toBe('dismissed');
  });
});
