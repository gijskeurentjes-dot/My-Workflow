import Anthropic from '@anthropic-ai/sdk';
import { config, hasAgentCredentials } from '../../../config.js';
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

/** Reported to the UI so it can say whether live execution is available. */
export function runtimeInfo(): { available: boolean; model: string; archetypes: string[] } {
  const runners = buildAgentRunners();
  return {
    available: runners.size > 0,
    model: config.agentModel,
    archetypes: [...runners.keys()],
  };
}
