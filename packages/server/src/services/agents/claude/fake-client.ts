import type Anthropic from '@anthropic-ai/sdk';

/**
 * A stand-in for the SDK client, for tests.
 *
 * Lives beside the runner rather than in the test file because it encodes real
 * response shapes — a web search result is a list on success and an object on
 * error, usage is snake_case, refusals arrive as HTTP 200 — and getting those
 * wrong in a fake would make the tests agree with a bug.
 *
 * No test in this suite reaches the network.
 */

export interface FakeTurn {
  text?: string;
  /** Searches this turn performed, with the URLs they returned. */
  searches?: { query: string; urls: { url: string; title?: string }[] }[];
  /** Simulate a search that failed. Its result block is an object, not a list. */
  searchError?: string;
  stopReason?: Anthropic.Message['stop_reason'];
  refusalCategory?: string;
  usage?: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  }>;
}

export interface FakeClientOptions {
  /** One entry per model turn, in order. */
  turns: FakeTurn[];
  /** What `messages.parse` returns as `parsed_output`. */
  parsed?: unknown;
  /** Throw this instead of answering, to exercise failure paths. */
  throws?: Error;
  /** Delay each call, so timeouts and cancellation can be tested. */
  delayMs?: number;
}

export interface FakeClient {
  client: Anthropic;
  /** Requests the runner actually made, for asserting on what was sent. */
  calls: { kind: 'stream' | 'parse'; params: Record<string, unknown> }[];
}

function buildMessage(turn: FakeTurn): Anthropic.Message {
  const content: Anthropic.ContentBlock[] = [];

  for (const search of turn.searches ?? []) {
    content.push({
      type: 'server_tool_use',
      id: `srvtoolu_${Math.random().toString(36).slice(2, 10)}`,
      name: 'web_search',
      input: { query: search.query },
    } as Anthropic.ContentBlock);

    content.push({
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_x',
      content: search.urls.map((u) => ({
        type: 'web_search_result',
        url: u.url,
        title: u.title ?? u.url,
        encrypted_content: '',
        page_age: null,
      })),
    } as unknown as Anthropic.ContentBlock);
  }

  if (turn.searchError) {
    // The error shape: content is a single object, not a list.
    content.push({
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_err',
      content: { type: 'web_search_tool_result_error', error_code: turn.searchError },
    } as unknown as Anthropic.ContentBlock);
  }

  if (turn.text !== undefined) {
    content.push({ type: 'text', text: turn.text, citations: null } as Anthropic.ContentBlock);
  }

  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content,
    stop_reason: turn.stopReason ?? 'end_turn',
    stop_sequence: null,
    stop_details: turn.refusalCategory
      ? ({ type: 'refusal', category: turn.refusalCategory, explanation: 'declined' } as never)
      : null,
    usage: {
      input_tokens: turn.usage?.input_tokens ?? 100,
      output_tokens: turn.usage?.output_tokens ?? 50,
      cache_read_input_tokens: turn.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: turn.usage?.cache_creation_input_tokens ?? 0,
    },
  } as unknown as Anthropic.Message;
}

export function createFakeClient(options: FakeClientOptions): FakeClient {
  const calls: FakeClient['calls'] = [];
  let turnIndex = 0;

  const wait = async (signal?: AbortSignal) => {
    if (!options.delayMs) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, options.delayMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('Request was aborted.');
        error.name = 'APIUserAbortError';
        reject(error);
      });
    });
  };

  const client = {
    messages: {
      stream(params: Record<string, unknown>, requestOptions?: { signal?: AbortSignal }) {
        calls.push({ kind: 'stream', params });
        const turn = options.turns[Math.min(turnIndex, options.turns.length - 1)];
        turnIndex += 1;

        return {
          on() {
            return this;
          },
          async finalMessage(): Promise<Anthropic.Message> {
            if (options.throws) throw options.throws;
            await wait(requestOptions?.signal);
            return buildMessage(turn ?? {});
          },
        };
      },

      async parse(params: Record<string, unknown>, requestOptions?: { signal?: AbortSignal }) {
        calls.push({ kind: 'parse', params });
        if (options.throws) throw options.throws;
        await wait(requestOptions?.signal);
        return {
          ...buildMessage({ text: 'structured' }),
          parsed_output: options.parsed ?? null,
        };
      },
    },
  };

  return { client: client as unknown as Anthropic, calls };
}
