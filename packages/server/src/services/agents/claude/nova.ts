import type { AgentArchetype } from '@ai-islands/shared';

/**
 * Nova, the Researcher — the first agent backed by a real model.
 *
 * The prompt itself lives with the archetype in the shared package, so the
 * agent that gets hired is told exactly what this runner expects of it: one
 * copy, read by the seed, by hiring, and by the runner. It is re-exported here
 * because this is where the code that depends on it lives.
 */
export { RESEARCHER_SYSTEM_PROMPT as NOVA_SYSTEM_PROMPT } from '@ai-islands/shared';

/**
 * The tools a researcher may use.
 *
 * This is an allow-list, not a suggestion: the executor refuses to start if an
 * agent asks for a tool that is not here, and never offers the model anything
 * outside it. Web search is read-only and runs on Anthropic's servers, so it
 * cannot touch this machine — no shell, no filesystem, no code execution, and
 * nothing that can send mail or spend money.
 */
export const RESEARCH_TOOLS = ['web_search'] as const;

export type ResearchTool = (typeof RESEARCH_TOOLS)[number];

/**
 * Tools that must never be given to an agent in this build, whatever its
 * stored brief says. Listed explicitly so adding one is a deliberate act with
 * a code review attached, rather than a config change nobody notices.
 */
export const FORBIDDEN_TOOLS = [
  'bash',
  'code_execution',
  'computer',
  'str_replace_based_edit_tool',
  'text_editor',
  'memory',
] as const;

/** Default execution limits for a research run. */
export const RESEARCH_DEFAULTS = {
  /** Wall-clock ceiling for one run. */
  maxExecutionMs: 180_000,
  /** Ceiling on tokens the model may generate. */
  maxOutputTokens: 16_000,
  /** How many web searches one run may perform. */
  maxSearches: 8,
  /** Finished research always comes back to you before it is delivered. */
  requiresApproval: true,
} as const;

/** Which archetypes have a real engine behind them today. */
export const LIVE_ARCHETYPES: readonly AgentArchetype[] = ['researcher'];

export const isLiveArchetype = (archetype: AgentArchetype): boolean =>
  LIVE_ARCHETYPES.includes(archetype);
