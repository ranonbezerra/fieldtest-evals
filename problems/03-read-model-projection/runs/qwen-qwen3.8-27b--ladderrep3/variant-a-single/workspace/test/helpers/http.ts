import type { TestApp } from './app.js';

export interface HttpResult<T> {
  status: number;
  body: T;
}

export function buildUrl(app: TestApp, path: string, query: Record<string, string> = {}): URL {
  const url = new URL(path, app.baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export async function getJson<T = unknown>(
  app: TestApp,
  path: string,
  query: Record<string, string> = {},
): Promise<HttpResult<T>> {
  const response = await fetch(buildUrl(app, path, query));
  return { status: response.status, body: (await response.json()) as T };
}

export async function postJson<T = unknown>(
  app: TestApp,
  path: string,
  body?: unknown,
): Promise<HttpResult<T>> {
  const response = await fetch(buildUrl(app, path), {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}
