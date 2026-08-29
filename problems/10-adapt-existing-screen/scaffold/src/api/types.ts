export type SessionStatus = 'open' | 'paused' | 'closed';

export interface Session {
  id: string;
  name: string;
  operator: string;
  status: SessionStatus;
  notes: string;
  startedAt: string;
  closedAt: string | null;
}

export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Order {
  id: string;
  reference: string;
  customer: string;
  status: OrderStatus;
  totalMinor: number;
  placedAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuthUser {
  id: string;
  name: string;
  roles: string[];
}
