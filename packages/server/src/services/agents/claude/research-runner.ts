import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import type { ResearchReport, RunUsage } from '@ai-islands/shared';
import { RunLimitError, type AgentRunContext, type AgentRunResult, type AgentRunner, type RunEventSink } from './types.js';

/**
 * The shape the model must return.
 *
 * Separating a fact from an assumption is not a stylistic preference here — it
 * is the schema, so a run cannot quietly blur the two. `openQuestions` exists
 * for the same reason: there is somewhere to put "I could not establish this",
 * which is what makes "if you lack information, say so" followable.
 */
const ResearchReportSchema = z.object({
  summary: z.string().describe('A short answer to the task, in plain prose.'),
  findings: z
    .array(
      z.object({
        statement: z.string().describe('The claim itself.'),
        kind: z
          .enum(['fact', 'assumption'])
          .describe(
            'fact: supported by a source you actually retrieved. assumption: your own reading, inference or prior knowledge.',
          ),
        sourceUrls: z
          .array(z.string())
          .describe('URLs of retrieved sources supporting this. Empty for an assumption.'),
      }),
    )
    .describe('What you established, each one labelled fact or assumption.'),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        relevance: z.string().describe('What this source contributed.'),
      }),
    )
    .describe('Only sources you actually retrieved during this run.'),
  openQuestions: z
    .array(z.string())
    .describe('What you could not establish. Say so rather than guessing.'),
  confidence: z.enum(['low', 'medium', 'high']),
});

const EMPTY_USAGE: RunUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  webSearches: 0,
};

/**
 * Runs a research task against a real Claude model.
 *
 * Two phases on purpose. The first does the research with web search and hands
 * back prose; the second turns that into the structured report. Splitting them
 * means the structured call cannot be the thing that invents a source — by then
 * every retrieval has already happened, and `retrievedUrls` is a record of what
 * was actually fetched, which is what the honesty check compares against.
 */
export class ResearchRunner implements AgentRunner {
  readonly archetype = 'researcher';

  constructor(private readonly client: Anthropic) {}

  async run(
    context: AgentRunContext,
    emit: RunEventSink,
    signal: AbortSignal,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const { agent, task, project, model } = context;

    emit({ type: 'started', taskId: task.id, model, at: startedAt });

    const usage: RunUsage = { ...EMPTY_USAGE };
    const retrievedUrls: string[] = [];
    const warnings: string[] = [];

    // ── Phase one: do the research ──────────────────────────────────────────
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildTaskPrompt(context) },
    ];

    let researchText = '';
    let stopReason: string | null = null;

    // A server-tool turn can stop with `pause_turn`; resuming means pushing the
    // paused assistant turn back and asking again. Bounded so a model that
    // never settles cannot loop forever.
    for (let turn = 0; turn < 6; turn += 1) {
      this.assertWithinTime(context, startedAt);

      const stream = this.client.messages.stream(
        {
          model,
          max_tokens: context.maxOutputTokens,
          system: agent.instructions,
          // Adaptive thinking, with the reasoning summarised so progress is
          // visible rather than a long silence.
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: 'high' },
          tools: buildTools(context),
          messages,
        },
        { signal },
      );

      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start' && event.content_block.type === 'thinking') {
          emit({ type: 'thinking', taskId: task.id, at: Date.now() });
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          emit({ type: 'text', taskId: task.id, delta: event.delta.text, at: Date.now() });
        }
      });

      const message = await stream.finalMessage();

      accumulateUsage(usage, message.usage);
      stopReason = message.stop_reason;

      // A safety decline is an outcome, not a crash: report it and stop.
      if (message.stop_reason === 'refusal') {
        return {
          outcome: 'refused',
          summary: refusalSummary(message),
          report: null,
          rawText: textOf(message),
          model,
          stopReason: message.stop_reason,
          usage,
          durationMs: Date.now() - startedAt,
          retrievedUrls,
          warnings,
        };
      }

      collectSearchResults(message, retrievedUrls, usage, emit, task.id);

      if (usage.webSearches > context.maxSearches) {
        throw new RunLimitError(
          `Run exceeded its search budget of ${context.maxSearches}.`,
          'searches',
        );
      }

      researchText = textOf(message);

      if (message.stop_reason === 'pause_turn') {
        // Push the paused turn back and continue; anything else ends the loop.
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      break;
    }

    // ── Phase two: structure what was found ─────────────────────────────────
    this.assertWithinTime(context, startedAt);
    emit({ type: 'structuring', taskId: task.id, at: Date.now() });

    const structured = await this.client.messages.parse(
      {
        model,
        max_tokens: Math.min(context.maxOutputTokens, 8000),
        system: agent.instructions,
        output_config: { format: zodOutputFormat(ResearchReportSchema) },
        messages: [
          { role: 'user', content: buildTaskPrompt(context) },
          { role: 'assistant', content: researchText || '(no findings)' },
          {
            role: 'user',
            content:
              'Now return that as the structured report. Use only sources you actually retrieved in this run. ' +
              'Label anything not supported by a retrieved source as an assumption, and put what you could not establish in openQuestions.',
          },
        ],
      },
      { signal },
    );

    accumulateUsage(usage, structured.usage);

    const report = (structured.parsed_output as ResearchReport | null) ?? null;
    if (!report) {
      warnings.push('The model did not return a parseable report; the prose answer was kept.');
    }

    // The brief says not to claim research that did not happen. This is where
    // that is checked rather than trusted: a cited URL that was never fetched
    // is surfaced, not silently passed on as evidence.
    if (report) warnings.push(...findUncitedSources(report, retrievedUrls));

    const durationMs = Date.now() - startedAt;
    emit({ type: 'finished', taskId: task.id, usage, at: Date.now() });

    return {
      outcome: 'completed',
      summary: report?.summary ?? firstParagraph(researchText),
      report,
      rawText: researchText,
      model,
      stopReason,
      usage,
      durationMs,
      retrievedUrls,
      warnings,
    };
  }

  /** Stop before the next model call if the run has already run too long. */
  private assertWithinTime(context: AgentRunContext, startedAt: number): void {
    if (Date.now() - startedAt > context.maxExecutionMs) {
      throw new RunLimitError(
        `Run exceeded its time limit of ${Math.round(context.maxExecutionMs / 1000)}s.`,
        'time',
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn the allow-list into tool definitions.
 *
 * Only names on the list become tools. Anything else was already rejected when
 * the run was prepared, so reaching this function with one is a bug, not a
 * configuration choice — hence the throw rather than a silent skip.
 */
function buildTools(context: AgentRunContext): Anthropic.ToolUnion[] {
  return context.tools.map((name): Anthropic.ToolUnion => {
    if (name === 'web_search') {
      return {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: context.maxSearches,
      };
    }
    throw new Error(`No definition for allowed tool "${name}" — refusing to run.`);
  });
}

/** The task, its project, and the boundaries of both. */
function buildTaskPrompt(context: AgentRunContext): string {
  const { task, project } = context;
  return [
    `Project: ${project.name}`,
    project.description ? `Project goal: ${project.description}` : null,
    '',
    `Task: ${task.title}`,
    task.description ? `Task details: ${task.description}` : null,
    '',
    'Research this and report what you find.',
    'Search the web for current information rather than relying on what you already know.',
    'Stay within this project and this task — do not research anything else.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function firstParagraph(text: string): string {
  const paragraph = text.split('\n\n')[0]?.trim() ?? '';
  return paragraph || 'The run produced no written answer.';
}

function refusalSummary(message: Anthropic.Message): string {
  const details = message.stop_details;
  const category = details && 'category' in details ? details.category : null;
  return category
    ? `The model declined this request (${category}).`
    : 'The model declined this request.';
}

function accumulateUsage(into: RunUsage, usage: Anthropic.Usage): void {
  into.inputTokens += usage.input_tokens ?? 0;
  into.outputTokens += usage.output_tokens ?? 0;
  into.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  into.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
}

/**
 * Record what web search actually retrieved.
 *
 * A search result block's `content` is a list on success and a single error
 * object on failure — the API returns HTTP 200 either way — so the shape has to
 * be checked before it is indexed.
 */
function collectSearchResults(
  message: Anthropic.Message,
  retrievedUrls: string[],
  usage: RunUsage,
  emit: RunEventSink,
  taskId: string,
): void {
  for (const block of message.content) {
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const input = block.input as { query?: unknown };
      if (typeof input?.query === 'string') {
        emit({ type: 'searching', taskId, query: input.query, at: Date.now() });
      }
      usage.webSearches += 1;
      continue;
    }

    if (block.type !== 'web_search_tool_result') continue;

    // An error result is an object, not a list. Indexing it would silently
    // produce nothing; branching says so.
    if (!Array.isArray(block.content)) continue;

    for (const result of block.content) {
      if (result.type === 'web_search_result' && !retrievedUrls.includes(result.url)) {
        retrievedUrls.push(result.url);
      }
    }
  }
}

/**
 * Sources the report claims but the run never fetched.
 *
 * Returned as warnings rather than a failure: a slightly-wrong citation should
 * not throw away good research, but it must not pass unremarked either.
 */
function findUncitedSources(report: ResearchReport, retrievedUrls: string[]): string[] {
  if (retrievedUrls.length === 0 && report.sources.length > 0) {
    return [
      `The report lists ${report.sources.length} source(s) but no web search was performed in this run.`,
    ];
  }

  const invented = report.sources.filter((source) => !retrievedUrls.includes(source.url));
  return invented.map(
    (source) => `Cited source was not retrieved during this run: ${source.url}`,
  );
}

export { ResearchReportSchema };
