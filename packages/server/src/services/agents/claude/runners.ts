import Anthropic from '@anthropic-ai/sdk';
import type { RuntimeInfo } from '@ai-islands/shared';
import { config, hasAgentCredentials } from '../../../config.js';
import { LIVE_ARCHETYPES } from './nova.js';
import { ResearchRunner } from './research-runner.js';
import type { AgentRunner } from './types.js';

/**
 * Which archetypes have a real engine behind them.
 *
 * Returns an empty map when no credentials are configured, so the app runs
 * exactly as before on the mock engine and asking to execute a real agent gets
 * a clear "no key configured" rather than a confusing API error.
 */
export function buildAgentRunners(client?: Anthropic): Map<string, AgentRunner> {
  const runners = new Map<string, AgentRunner>();

  if (!client && !hasAgentCredentials()) return runners;

  // The SDK reads ANTHROPIC_API_KEY from the environment itself; passing it
  // explicitly would put the secret on a call site for no benefit.
  const anthropic = client ?? new Anthropic({ maxRetries: 2 });

  const researcher = new ResearchRunner(anthropic);
  runners.set(researcher.archetype, researcher);

  return runners;
}

/**
 * Reported to the UI so it can say whether live execution is available.
 *
 * Derived from configuration rather than by building runners, because this is
 * read on every snapshot and constructing an API client to answer a question
 * about configuration would be wasteful.
 */
export function runtimeInfo(): RuntimeInfo {
  const configured = hasAgentCredentials();
  return {
    // Today these coincide; they are separate fields because "a key is set" and
    // "something can actually run" are different claims, and the UI makes both.
    available: configured && LIVE_ARCHETYPES.length > 0,
    credentialsConfigured: configured,
    model: config.agentModel,
    archetypes: configured ? [...LIVE_ARCHETYPES] : [],
    maxSearches: config.agentMaxSearches,
  };
}
