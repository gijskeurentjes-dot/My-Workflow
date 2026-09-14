import { afterEach, describe, expect, it } from 'vitest';
import { ARCHETYPES, TASK_TYPES } from '@ai-islands/shared';
import { createTestWorld, type TestWorld } from '../test/helpers.js';
import { seedWorld } from './seed.js';

describe('the demo world', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('creates a project for every island, each with its own appearance', () => {
    w = createTestWorld();
    const projects = w.repos.projects.list();
    expect(projects.length).toBeGreaterThanOrEqual(3);

    // Two projects sharing a seed would draw the same island.
    const seeds = new Set(projects.map((p) => p.appearance.seed));
    expect(seeds.size).toBe(projects.length);

    for (const project of projects) {
      expect(project.appearance.biome).toBeTruthy();
      expect(project.description.length).toBeGreaterThan(0);
    }
  });

  it('gives every project its own team, and teams differ in shape', () => {
    w = createTestWorld();
    const projects = w.repos.projects.list();

    const sizes = projects.map((p) => w.repos.agents.findByProject(p.id).length);
    for (const size of sizes) expect(size).toBeGreaterThan(0);
    // The point of per-project teams is that they are not all identical.
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });

  it('gives every agent a project that exists', () => {
    w = createTestWorld();
    for (const agent of w.repos.agents.list()) {
      expect(w.repos.projects.findById(agent.projectId), `${agent.name} has no project`).not.toBeNull();
      expect(ARCHETYPES[agent.archetype]).toBeDefined();
    }
  });

  it('routes every task to the building its kind of work belongs to', () => {
    w = createTestWorld();
    for (const task of w.repos.tasks.list()) {
      expect(task.buildingKey).toBe(TASK_TYPES[task.type].building);
    }
  });

  it('keeps a task and its agent on the same project', () => {
    w = createTestWorld();
    for (const task of w.repos.tasks.list()) {
      if (!task.assignedAgentId) continue;
      const agent = w.repos.agents.findById(task.assignedAgentId);
      expect(agent, `${task.title} points at a missing agent`).not.toBeNull();
      expect(agent!.projectId).toBe(task.projectId);
    }
  });

  it('shows every state the UI has to render', () => {
    w = createTestWorld();
    const agentStatuses = new Set(w.repos.agents.list().map((a) => a.status));
    // A first-time visitor should see someone working, someone waiting on them,
    // someone blocked and someone paused without touching anything.
    expect(agentStatuses).toContain('working');
    expect(agentStatuses).toContain('waiting_approval');
    expect(agentStatuses).toContain('failed');
    expect(agentStatuses).toContain('paused');

    const taskStatuses = new Set(w.repos.tasks.list().map((t) => t.status));
    expect(taskStatuses).toContain('backlog');
    expect(taskStatuses).toContain('completed');
  });

  it('leaves an approval waiting in the queue', () => {
    w = createTestWorld();
    const pending = w.repos.approvals.list({ status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(w.repos.tasks.findById(pending[0]!.taskId)?.status).toBe('waiting_approval');
  });

  it('keeps agent and task agreed on who holds what', () => {
    w = createTestWorld();
    for (const agent of w.repos.agents.list()) {
      if (!agent.currentTaskId) continue;
      const task = w.repos.tasks.findById(agent.currentTaskId);
      expect(task, `${agent.name} holds a task that does not exist`).not.toBeNull();
      expect(task!.assignedAgentId).toBe(agent.id);
    }
    for (const task of w.repos.tasks.list()) {
      if (!task.assignedAgentId || task.status === 'completed') continue;
      expect(w.repos.agents.findById(task.assignedAgentId)!.currentTaskId).toBe(task.id);
    }
  });

  it('crates delivered work against the project it belongs to', () => {
    w = createTestWorld();
    for (const project of w.repos.projects.list()) {
      const completed = w.repos.tasks
        .list({ projectId: project.id })
        .filter((t) => t.status === 'completed').length;
      expect(project.crates, `${project.name} crate count`).toBe(completed);
    }
  });

  it('is reproducible — a reset replays the same world', () => {
    w = createTestWorld();
    const before = w.repos.tasks.list().map((t) => t.title).sort();

    w.repos.reset();
    expect(w.repos.projects.list()).toHaveLength(0);

    // Re-seed and compare shape, not ids, which are random by design.
    seedWorld(w.repos, w.now());
    expect(w.repos.tasks.list().map((t) => t.title).sort()).toEqual(before);
  });
});
