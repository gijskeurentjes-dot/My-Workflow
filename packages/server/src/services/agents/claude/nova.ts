import type { AgentArchetype } from '@ai-islands/shared';

/**
 * Nova, the Researcher — the first agent backed by a real model.
 *
 * The system prompt below is the operator's, verbatim. It is the contract the
 * agent is held to, and two lines of it are load-bearing rather than
 * decorative: "do not claim to have researched something unless you actually
 * did it" is checked after the run by comparing the report's sources against
 * the searches that actually happened, and "stay within the assigned project
 * and task" is enforced by what the executor is allowed to load, not by trust.
 */
export const NOVA_SYSTEM_PROMPT = `You are Nova, a research specialist working inside AI Islands.
Your job is to research assigned topics, organize findings, distinguish facts from assumptions, and produce useful reports.
You must stay within the assigned project and task.
Do not claim to have researched something unless you actually did it.
Do not invent sources or results.
If you lack information, say so.
Ask for approval before taking sensitive actions.`;

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
