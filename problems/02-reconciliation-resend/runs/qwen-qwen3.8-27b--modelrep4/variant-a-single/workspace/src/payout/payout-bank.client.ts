import { Injectable } from '@nestjs/common';
import {
  BankClient,
  BankSendInput,
  BankSendResult,
  BankSettlement,
} from './bank-client.token.js';

// ASSUMPTION: The bank API is JSON over HTTP: POST `${BANK_API_URL}/payments` and GET `${BANK_API_URL}/statements/:date`.
@Injectable()
export class PayoutBankClient implements BankClient {
  private readonly timeoutMs = 10_000;

  private baseUrl(): string {
    const url = process.env.BANK_API_URL;
    if (!url) {
      throw new Error('BANK_API_URL is not set');
    }
    return url.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    const apiKey = process.env.BANK_API_KEY;
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  private static fallbackMessage(
    status: number,
    body: { message?: unknown },
  ): string {
    if (typeof body.message === 'string' && body.message.length > 0) {
      return body.message;
    }
    return `bank response: HTTP ${status}`;
  }

  async send(input: BankSendInput): Promise<BankSendResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}/payments`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          txid: input.txid,
          amount: input.amount,
          key: input.key,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error('bank.send failed: transient network or timeout');
    }

    const body = (await response.json().catch(() => ({}))) as {
      status?: unknown;
      message?: unknown;
      duplicate?: unknown;
      txid?: unknown;
    };
    const bodyTxid = typeof body.txid === 'string' ? body.txid : input.txid;

    if (response.ok) {
      if (body.status === 'permanent') {
        return {
          kind: 'permanent',
          message: PayoutBankClient.fallbackMessage(response.status, body),
        };
      }
      if (body.duplicate === true || body.status === 'duplicate') {
        return { kind: 'duplicate', txid: bodyTxid };
      }
      return { kind: 'accepted', txid: bodyTxid };
    }

    if (
      response.status === 409 &&
      (body.duplicate === true || body.status === 'duplicate')
    ) {
      return { kind: 'duplicate', txid: bodyTxid };
    }

    if (
      body.status === 'transient' ||
      [408, 425, 429, 500, 502, 503, 504].includes(response.status)
    ) {
      return {
        kind: 'transient',
        message: PayoutBankClient.fallbackMessage(response.status, body),
      };
    }

    if (
      body.status === 'permanent' ||
      [400, 401, 402, 403, 404, 422].includes(response.status)
    ) {
      return {
        kind: 'permanent',
        message: PayoutBankClient.fallbackMessage(response.status, body),
      };
    }

    return {
      kind: response.status >= 500 ? 'transient' : 'permanent',
      message: PayoutBankClient.fallbackMessage(response.status, body),
    };
  }

  async getStatement(date: string): Promise<BankSettlement[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}/statements/${encodeURIComponent(date)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error('bank.getStatement failed: transient network or timeout');
    }

    if (response.status === 404) {
      return [];
    }
    if (!response.ok) {
      throw new Error(`bank.getStatement failed: HTTP ${response.status}`);
    }

    const raw = await response.json().catch(() => ({}));
    const list = Array.isArray(raw)
      ? raw
      : (raw as { settlements?: unknown }).settlements;

    if (!Array.isArray(list)) {
      return [];
    }

    return list.map((item): BankSettlement => {
      const row = item as Record<string, unknown>;
      const txidRaw = row.txid ?? row.txId;
      if (typeof txidRaw !== 'string' || txidRaw.length === 0) {
        throw new Error('bank.getStatement returned a settlement without txid');
      }

      const amountRaw = row.amount ?? row.amount_minor ?? 0;
      const amount = Number(amountRaw);
      if (!Number.isInteger(amount)) {
        throw new Error('bank.getStatement returned non-integer amount');
      }

      const settledAtRaw = row.settled_at ?? row.settledAt;
      let settledAt: string | undefined;
      if (typeof settledAtRaw === 'string' || typeof settledAtRaw === 'number') {
        const parsed = new Date(settledAtRaw as string | number);
        if (!Number.isNaN(parsed.getTime())) {
          settledAt = parsed.toISOString();
        }
      }

      const referenceRaw = row.bank_reference ?? row.bankReference;

      return {
        txid: txidRaw,
        amount,
        settledAt,
        bankReference:
          typeof referenceRaw === 'string' || typeof referenceRaw === 'number'
            ? String(referenceRaw)
            : undefined,
      };
    });
  }
}
