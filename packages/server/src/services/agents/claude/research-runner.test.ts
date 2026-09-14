import { describe, expect, it } from 'vitest';
import type { Agent, Project, ResearchReport, Task } from '@ai-islands/shared';
import { createFakeClient } from './fake-client.js';
import { ResearchRunner } from './research-runner.js';
import { NOVA_SYSTEM_PROMPT } from './nova.js';
import type { AgentRunContext, RunEvent } from './types.js';

/**
 * Nova against a stubbed client. No test here reaches the network — the fake
 * encodes the real response shapes so these assertions mean something.
 */

const REPORT: ResearchReport = {
  summary: 'Three competitors dominate the mid-market.',
  findings: [
    { statement: 'Acme leads on price.', kind: 'fact', sourceUrls: ['https://acme.example/pricing'] },
    { statement: 'They will likely cut prices again.', kind: 'assumption', sourceUrls: [] },
  ],
  sources: [
    { title: 'Acme pricing', url: 'https://acme.example/pricing', relevance: 'List prices.' },
  ],
  openQuestions: ['Private company revenue is not published.'],
  confidence: 'medium',
};

function buildContext(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  const agent = {
    id: 'agt_1',
    projectId: 'prj_1',
    archetype: 'researcher',
    name: 'Nova',
    role: 'Researcher',
    instructions: NOVA_SYSTEM_PROMPT,
    tools: ['web_search'],
    model: 'claude-opus-5',
    maxExecutionMs: 180_000,
    maxOutputTokens: 16_000,
    requiresApproval: true,
    status: 'working',
    currentTaskId: 'tsk_1',
    currentLocation: 'library',
    movement: null,
    progress: 0,
    createdAt: 0,
    updatedAt: 0,
  } as Agent;

  const task = {
    id: 'tsk_1',
    projectId: 'prj_1',
    assignedAgentId: 'agt_1',
    title: 'Research the top competitors in my market and create a summary.',
    description: 'Mid-market SaaS.',
    type: 'research',
    status: 'working',
    priority: 'normal',
    buildingKey: 'library',
    progress: 0,
    durationSeconds: 120,
    needsApproval: true,
    blocker: null,
    createdAt: 0,
    updatedAt: 0,
    startedAt: null,
    completedAt: null,
  } as Task;

  const project = {
    id: 'prj_1',
    name: 'Market Research Refresh',
    description: 'Understand where we sit.',
    status: 'active',
    color: '#7a63d8',
    appearance: { biome: 'scholar', seed: 3.9, layout: { col: 0, row: 0 } },
    crates: 0,
    createdAt: 0,
    updatedAt: 0,
  } as Project;

  return {
    agent,
    task,
    project,
    tools: ['web_search'],
    model: 'claude-opus-5',
    maxExecutionMs: 180_000,
    maxOutputTokens: 16_000,
    maxSearches: 8,
    ...overrides,
  };
}

const collect = () => {
  const events: RunEvent[] = [];
  return { events, emit: (e: RunEvent) => events.push(e) };
};

describe('Nova, the research runner', () => {
  it('sends the agent’s brief as the system prompt', async () => {
    const { client, calls } = createFakeClient({ turns: [{ text: 'Findings…' }], parsed: REPORT });
    await new ResearchRunner(client).run(buildContext(), collect().emit, new AbortController().signal);

    const research = calls.find((c) => c.kind === 'stream')!;
    expect(research.params.system).toBe(NOVA_SYSTEM_PROMPT);
    expect(research.params.model).toBe('claude-opus-5');
  });

  /**
   * The allow-list is the security boundary. If this ever offers a tool that
   * can touch the machine, the sandbox around the agent is gone.
   */
  it('offers only web search, and never a tool that can touch this machine', async () => {
    const { client, calls } = createFakeClient({ turns: [{ text: 'x' }], parsed: REPORT });
    await new ResearchRunner(client).run(buildContext(), collect().emit, new AbortController().signal);

    const tools = calls.find((c) => c.kind === 'stream')!.params.tools as { type: string; name: string }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('web_search');
    expect(tools[0]!.type).toBe('web_search_20260209');

    const names = tools.map((t) => t.name);
    for (const forbidden of ['bash', 'code_execution', 'str_replace_based_edit_tool', 'computer']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('refuses to run a tool it has no definition for', async () => {
    const { client } = createFakeClient({ turns: [{ text: 'x' }], parsed: REPORT });
    const context = buildContext({ tools: ['send_email'] });

    await expect(
      new ResearchRunner(client).run(context, collect().emit, new AbortController().signal),
    ).rejects.toThrow(/no definition for allowed tool/i);
  });

  it('records the sources it actually retrieved', async () => {
    const { client } = createFakeClient({
      turns: [
        {
          text: 'Found three.',
          searches: [
            {
              query: 'mid-market SaaS competitors',
              urls: [{ url: 'https://acme.example/pricing' }, { url: 'https://beta.example' }],
            },
          ],
        },
      ],
      parsed: REPORT,
    });

    const result = await new ResearchRunner(client).run(
      buildContext(),
      collect().emit,
      new AbortController().signal,
    );

    expect(result.retrievedUrls).toEqual(['https://acme.example/pricing', 'https://beta.example']);
    expect(result.usage.webSearches).toBe(1);
  });

  /**
   * "Do not claim to have researched something unless you actually did it" is
   * checked, not trusted. A cited URL that was never fetched is surfaced.
   */
  it('flags a cited source that was never actually retrieved', async () => {
    const { client } = createFakeClient({
      turns: [
        {
          text: 'Found one.',
          searches: [{ query: 'competitors', urls: [{ url: 'https://acme.example/pricing' }] }],
        },
      ],
      parsed: {
        ...REPORT,
        sources: [
          ...REPORT.sources,
          { title: 'Invented', url: 'https://nowhere.example/made-up', relevance: 'None.' },
        ],
      },
    });

    const result = await new ResearchRunner(client).run(
      buildContext(),
      collect().emit,
      new AbortController().signal,
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('https://nowhere.example/made-up');
  });

  it('flags a report with sources when no search happened at all', async () => {
    const { client } = createFakeClient({ turns: [{ text: 'From memory.' }], parsed: REPORT });
    const result = await new ResearchRunner(client).run(
      buildContext(),
      collect().emit,
      new AbortController().signal,
    );

    expect(result.usage.webSearches).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/no web search was performed/i);
  });

  /** A failed search returns HTTP 200 with an object, not a list. */
  it('survives a failed search without inventing a source', async () => {
    const { client } = createFakeClient({
      turns: [{ text: 'Search failed.', searchError: 'max_uses_exceeded' }],
      parsed: { ...REPORT, sources: [] },
    });

    const result = await new ResearchRunner(client).run(
      buildContext(),
      collect().emit,
      new AbortController().signal,
    );

    expect(result.retrievedUrls).toEqual([]);
    expect(result.outcome).toBe('completed');
  });

  it('resumes a paused turn instead of returning half an answer', async () => {
    const { client, calls } = createFakeClient({
      turns: [
        { text: 'Partway…', stopReason: 'pause_turn' },
        { text: 'Complete answer.', stopReason: 'end_turn' },
      ],
      parsed: REPORT,
    });

    const result = await new ResearchRunner(client).run(
      buildContext(),
      collect().emit,
      new AbortController().signal,
    );

    // Two research turns, then the structuring call.
    expect(calls.filter((c) => c.kind === 'stream')).toHaveLength(2);
    expect(result.rawText).toBe('Complete answer.');
  });

  it('reports a refusal as an outcome rather than throwing', async () => {
    const { client } = createFakeClient({
      turns: [{ text: '', stopReason: 'refusal', refusalCategory: 'cyber' }],
    });

    const result = await new ResearchRunner(client).run(
      buildContext(),
      collect().emit,
      new AbortController().signal,
    );

    expect(result.outcome).toBe('refused');
    expect(result.summary).toContain('cyber');
    expect(result.report).toBeNull();
  });

  it('keeps the prose when the structured parse comes back empty', async () => {
    const { client } = createFakeClient({ turns: [{ text: 'Useful prose.' }], parsed: null });
    const result = await new ResearchRunner(client).run(
      buildContext(),
      collect().emit,
      new AbortController().signal,
    );

    expect(result.report).toBeNull();
    expect(result.summary).toBe('Useful prose.');
    expect(result.warnings.join(' ')).toMatch(/did not return a parseable report/i);
  });

  it('adds up usage across every call it made', async () => {
    const { client } = createFakeClient({
      turns: [{ text: 'a', usage: { input_tokens: 500, output_tokens: 200 } }],
      parsed: REPORT,
    });

    const result = await new ResearchRunner(client).run(
      buildContext(),
      collect().emit,
      new AbortController().signal,
    );

    // The research turn plus the structuring call.
    expect(result.usage.inputTokens).toBe(600);
    expect(result.usage.outputTokens).toBe(250);
  });

  it('stops when the run passes its time limit', async () => {
    // Each turn costs real time in the fake, so the guard before the second
    // model call is what trips — a run is stopped between turns, not mid-call.
    const { client } = createFakeClient({
      turns: [
        { text: 'slow', stopReason: 'pause_turn' },
        { text: 'slower', stopReason: 'pause_turn' },
      ],
      parsed: REPORT,
      delayMs: 25,
    });

    const promise = new ResearchRunner(client).run(
      buildContext({ maxExecutionMs: 10 }),
      collect().emit,
      new AbortController().signal,
    );

    await expect(promise).rejects.toThrow(/time limit/i);
  });

  it('reports progress as it goes', async () => {
    const { client } = createFakeClient({
      turns: [{ text: 'x', searches: [{ query: 'competitors', urls: [{ url: 'https://a.example' }] }] }],
      parsed: REPORT,
    });

    const { events, emit } = collect();
    await new ResearchRunner(client).run(buildContext(), emit, new AbortController().signal);

    const kinds = events.map((e) => e.type);
    expect(kinds).toContain('started');
    expect(kinds).toContain('searching');
    expect(kinds).toContain('structuring');
    expect(kinds).toContain('finished');

    const search = events.find((e) => e.type === 'searching');
    expect(search && 'query' in search ? search.query : '').toBe('competitors');
  });
});
