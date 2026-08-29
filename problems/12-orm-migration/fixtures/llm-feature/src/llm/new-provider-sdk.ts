/**
 * Fake of the cloud provider's documented SDK surface. No network.
 *
 * Documented differences from the local server, quoted from their migration guide:
 *
 *   - "Stream events carry byte slices of the UTF-8 response. A multi-byte
 *      character MAY be split across two events; decode incrementally."
 *   - "Errors are `ProviderApiError` with a `type` of `rate_limit_error`,
 *      `timeout_error`, `content_policy_violation` or `api_error`."
 *   - "`max_output_tokens` replaces `max_tokens`. Token accounting is returned on
 *      the terminal `message_stop` event."
 */
export type ProviderErrorType =
  | 'rate_limit_error'
  | 'timeout_error'
  | 'content_policy_violation'
  | 'api_error';

export class ProviderApiError extends Error {
  constructor(public readonly type: ProviderErrorType) {
    super(type);
  }
}

export type StreamEvent =
  | { type: 'content_block_delta'; bytes: Uint8Array }
  | { type: 'message_stop'; usage: { inputTokens: number; outputTokens: number } };

export interface CreateMessageParams {
  prompt: string;
  maxOutputTokens: number;
}

export interface ProviderSdk {
  messages: {
    stream(params: CreateMessageParams): AsyncGenerator<StreamEvent>;
  };
}
