import { apiFetch } from './client';
import type { LoginResponse } from './types';

// ASSUMPTION: the login route and request payload are not fixed by the variant.
export async function requestLogin(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}
