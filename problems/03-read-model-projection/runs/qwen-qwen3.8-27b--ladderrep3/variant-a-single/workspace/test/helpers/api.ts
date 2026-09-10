// Wire-level response shapes used by the tests (snake_case, as served).

export interface OrderBody {
  id: string;
  company_id: string;
  worker_id: string;
  event_id: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

export interface OperationItem {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  event_id: string;
  event_name: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

export interface ListBody {
  items: OperationItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface TotalsBody {
  company_id: string;
  pending_amount_cents: string;
  approved_amount_cents: string;
  rejected_amount_cents: string;
  orders_count: number;
}

export interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}
