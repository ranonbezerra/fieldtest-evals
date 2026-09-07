export type SessionStatus = 'open' | 'closed';

export interface Session {
  id: string;
  name: string;
  status: SessionStatus;
  /** ISO 8601 timestamp; the basis for the bar's ticking elapsed time. */
  started_at: string;
  notes: string;
}

// ASSUMPTION: the variant fixes list behaviour (filtering + pagination) but
// not the wire shape; { items, total } is the platform shape.
export interface PagedSessions {
  items: Session[];
  total: number;
}

export interface SessionListParams {
  status: 'all' | SessionStatus;
  page: number;
  pageSize: number;
}

export interface User {
  id: string;
  name: string;
}

// ASSUMPTION: the login response carries the bearer token plus the
// operator's profile.
export interface LoginResponse {
  token: string;
  user: User;
}
