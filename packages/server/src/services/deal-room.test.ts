import { afterEach, describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  DEAL_AGENT_IDS,
  DEAL_AGENT_LIST,
  DEAL_PHASES,
  DEAL_ROOM_AGENTS,
  RESEARCHER_SYSTEM_PROMPT,
  dealAgentInstructions,
  defaultInstructions,
  type DealAgentId,
} from '@ai-islands/shared';
import { WorkflowError } from '../errors.js';
import { createTestWorld, type TestWorld } from '../test/helpers.js';

/**
 * The M&A Deal Room: five named specialists, and nobody else.
 *
 * The registry is the point of the thing — a deal room is a place where
 * confidential work is done by a known team under explicit permissions, so
 * "who did this?" must always have an answer. These tests hold that line where
 * it is actually enforceable: in the server, not in a prompt.
 */

describe('the fixed agent registry', () => {
  it('is exactly five agents, by name and role', () => {
    expect(DEAL_AGENT_IDS).toEqual(['atlas', 'nova', 'forge', 'ledger', 'canvas']);
    expect(DEAL_AGENT_LIST.map((a) => `${a.name} — ${a.role}`)).toEqual([
      'Atlas — M&A Project Manager',
      'Nova — M&A Researcher',
      'Forge — Developer and Automation Engineer',
      'Ledger — Financial Modeling and Excel Specialist',
      'Canvas — PowerPoint and Deal Presentation Specialist',
    ]);
  });

  it('gives every agent permissions, restrictions and a place to work', () => {
    for (const agent of DEAL_AGENT_LIST) {
      expect(agent.permissions.length).toBeGreaterThan(0);
      expect(agent.restrictedActions.length).toBeGreaterThan(0);
      expect(agent.responsibilities.length).toBeGreaterThan(0);
      expect(ARCHETYPES[agent.archetype]).toBeDefined();
      expect(agent.home).toBe(ARCHETYPES[agent.archetype].home);
    }
  });

  /**
   * The restriction that matters most: nothing in this build can produce a
   * sixth agent. There is no factory, no "spawn" call, and the registry is a
   * frozen-in-code record rather than a list something could append to.
   */
  it('has no way to add a sixth agent', () => {
    const ids = Object.keys(DEAL_ROOM_AGENTS) as DealAgentId[];
    expect(ids).toHaveLength(5);
    // Every agent is told it cannot create others, and the two that delegate
    // are told so explicitly.
    for (const agent of DEAL_AGENT_LIST) {
      expect(dealAgentInstructions(agent)).toContain('You cannot create other agents');
    }
    expect(DEAL_ROOM_AGENTS.atlas.restrictedActions).toContain('Spawn additional agents');
    expect(DEAL_ROOM_AGENTS.forge.restrictedActions).toContain('Spawn agents');
  });

  it('writes each brief from that agent’s own permissions', () => {
    const brief = dealAgentInstructions(DEAL_ROOM_AGENTS.ledger);

    expect(brief).toContain('You are Ledger, the Financial Modeling and Excel Specialist');
    expect(brief).toContain('Ask for approval before:');
    expect(brief).toContain('Finalising a valuation conclusion');
    expect(brief).toContain('You must never:');
    expect(brief).toContain('Present estimates as verified financial facts');
    // The output standards travel with the brief, not in someone's head.
    expect(brief).toContain('No unexplained hard-coded values');
  });

  it('runs the nine deal phases in order', () => {
    expect(DEAL_PHASES.map((p) => p.label)).toEqual([
      'Deal Setup',
      'Information Collection',
      'Commercial Due Diligence',
      'Financial Due Diligence',
      'Valuation',
      'Deal Structuring',
      'Investment Committee Preparation',
      'Review and Approval',
      'Final Deliverables',
    ]);
  });
});

describe('creating a deal room', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('hires the five, and only the five', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ template: 'deal_room' });

    expect(project.name).toBe('M&A Deal Room');
    expect(project.template).toBe('deal_room');

    const team = w.repos.agents.findByProject(project.id);
    expect(team.map((a) => a.name).sort()).toEqual([
      'Atlas',
      'Canvas',
      'Forge',
      'Ledger',
      'Nova',
    ]);
  });

  it('gives each of them their own role, brief and tools', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ template: 'deal_room' });
    const team = w.repos.agents.findByProject(project.id);

    const ledger = team.find((a) => a.name === 'Ledger')!;
    expect(ledger.role).toBe('Financial Modeling and Excel Specialist');
    expect(ledger.archetype).toBe('analyst');
    expect(ledger.instructions).toBe(dealAgentInstructions(DEAL_ROOM_AGENTS.ledger));
    expect(ledger.tools).toEqual(DEAL_ROOM_AGENTS.ledger.tools);

    const canvas = team.find((a) => a.name === 'Canvas')!;
    expect(canvas.archetype).toBe('presenter');
    expect(canvas.instructions).toContain('Ask for approval before:');
  });

  it('puts each agent at the building they work from', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ template: 'deal_room' });
    const team = w.repos.agents.findByProject(project.id);

    const where = Object.fromEntries(team.map((a) => [a.name, a.currentLocation]));
    expect(where).toEqual({
      Atlas: 'hq',
      Nova: 'library',
      Forge: 'workshop',
      Ledger: 'data',
      Canvas: 'studio',
    });
  });

  it('refuses a team someone tried to choose instead', () => {
    w = createTestWorld({ seed: false });
    expect(() =>
      w.workflow.createProject({ name: 'Project Helix', template: 'deal_room', team: ['pm'] }),
    ).toThrow(/fixed|cannot be chosen/i);
  });

  it('takes a name of your own when you give one', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({
      name: 'Project Helix',
      description: 'Acquisition of a mid-market SaaS company.',
      template: 'deal_room',
    });
    expect(project.name).toBe('Project Helix');
    expect(project.description).toBe('Acquisition of a mid-market SaaS company.');
  });
});

describe('the deal room team cannot change', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  const dealRoom = () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ template: 'deal_room' });
    return project;
  };

  it('refuses to hire a sixth agent onto it', () => {
    const project = dealRoom();
    expect(() => w.workflow.hireAgent(project.id, 'researcher', 'Echo')).toThrow(WorkflowError);
    expect(() => w.workflow.hireAgent(project.id, 'researcher', 'Echo')).toThrow(/fixed team/i);
    expect(w.repos.agents.findByProject(project.id)).toHaveLength(5);
  });

  it('refuses to dismiss one of the five', () => {
    const project = dealRoom();
    const nova = w.repos.agents.findByProject(project.id).find((a) => a.name === 'Nova')!;

    expect(() => w.workflow.dismissAgent(nova.id)).toThrow(/cannot be dismissed/i);
    expect(w.repos.agents.findById(nova.id)).not.toBeNull();
  });

  it('leaves ordinary projects free to hire and dismiss as before', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Website refresh' });

    const { agent } = w.workflow.hireAgent(project.id, 'developer', 'Bolt');
    expect(w.repos.agents.findByProject(project.id)).toHaveLength(2);

    w.workflow.dismissAgent(agent.id);
    expect(w.repos.agents.findByProject(project.id)).toHaveLength(1);
  });

  it('keeps each deal room’s team to itself', () => {
    const first = dealRoom();
    const { project: second } = w.workflow.createProject({
      name: 'Project Meridian',
      template: 'deal_room',
    });

    expect(w.repos.agents.findByProject(first.id)).toHaveLength(5);
    expect(w.repos.agents.findByProject(second.id)).toHaveLength(5);
    // Ten agents, two teams, no sharing.
    expect(w.repos.agents.list()).toHaveLength(10);
  });
});

describe('the existing Researcher is untouched', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  /**
   * The lines the live runner's honesty check exists to enforce. If a future
   * edit softens them, this fails before anything reaches a model.
   */
  it('still hires an ordinary Nova with the operator’s own brief', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Market study', team: ['researcher'] });
    const nova = w.repos.agents.findByProject(project.id)[0]!;

    expect(nova.name).toBe('Nova');
    expect(nova.instructions).toBe(RESEARCHER_SYSTEM_PROMPT);
    expect(nova.instructions).toContain(
      'Do not claim to have researched something unless you actually did it.',
    );
    expect(nova.instructions).toContain('Do not invent sources or results.');
    expect(defaultInstructions(ARCHETYPES.researcher)).toBe(RESEARCHER_SYSTEM_PROMPT);
  });

  /**
   * The deal room's Nova is a different brief for a different job, but she is
   * held to the same standard about sources — she is still run by the same
   * runner, and the same check.
   */
  it('holds the deal room’s Nova to the same standard about sources', () => {
    const brief = dealAgentInstructions(DEAL_ROOM_AGENTS.nova);

    expect(brief).toContain('never invent a figure or a source');
    expect(brief).toContain('Every claim carries the source it came from');
    expect(brief).toContain('Stay inside the M&A Deal Room project');
    expect(DEAL_ROOM_AGENTS.nova.archetype).toBe('researcher');
  });

  it('can still be executed for real, because she is still a researcher', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ template: 'deal_room' });
    const nova = w.repos.agents.findByProject(project.id).find((a) => a.name === 'Nova')!;

    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Research the competitive landscape',
      type: 'research',
      agentId: nova.id,
    });

    // The live runtime decides by archetype, and hers is unchanged.
    expect(task.assignedAgentId).toBe(nova.id);
    expect(nova.archetype).toBe('researcher');
    expect(nova.tools).toContain('Web research');
  });
});
