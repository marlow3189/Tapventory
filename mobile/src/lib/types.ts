// Kształty danych zwracanych przez widoki i tabele (ręczne typy).
// Gdy schemat bazy się zmienia, najpewniej wygenerować je z bazy:
//   npx supabase gen types typescript --local > src/lib/database.types.ts
// (opis w docs/05_*). Do tego czasu trzymamy tu tylko to, czego aplikacja używa.

import type { RequestStatus } from './status';

export type Role = 'owner' | 'manager' | 'employee';

export type Membership = {
  id: string;
  tenant_id: string;
  role: Role;
  can_manage_managers: boolean;
  can_manage_billing: boolean;
  tenants: { id: string; name: string; nip: string | null; plan: 'solo' | 'start' | 'team' } | null;
};

export type ProductRow = {
  id: string;
  tenant_id: string;
  name: string;
  ean: string | null;
  unit: string;
  pack_size: number | string;
  min_stock: number | string;
  photo_path: string | null;
  active: boolean;
  default_supplier_id: string | null;
  default_supplier_name: string | null;
  stock: number | string;
  below_min: boolean;
  last_movement_at: string | null;
  created_at: string;
};

export type RequestFeedRow = {
  id: string;
  tenant_id: string;
  status: RequestStatus;
  qty: number | string | null;
  note: string | null;
  free_name: string | null;
  photo_path: string | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  ordered_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  reporter_id: string;
  reporter_name: string;
  reporter_deleted: boolean;
  product_id: string | null;
  product_name: string | null;
  product_unit: string | null;
  product_photo_path: string | null;
  project_id: string | null;
  project_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  message_count: number;
  last_message_at: string | null;
  vote_count: number;
  voted_by_me: boolean;
};

export type MessageRow = {
  id: string;
  request_id: string;
  author_id: string;
  author_name: string;
  author_deleted: boolean;
  body: string;
  created_at: string;
};

export type EventRow = {
  id: number;
  request_id: string;
  from_status: RequestStatus | null;
  to_status: RequestStatus;
  actor_name: string | null;
  created_at: string;
};

export type MovementRow = {
  id: string;
  product_id: string;
  product_name: string;
  product_unit: string;
  movement_type: 'receipt' | 'issue' | 'adjustment' | 'return';
  qty: number | string;
  reason: 'use' | 'damage' | 'expired' | 'other' | null;
  note: string | null;
  author_name: string;
  author_deleted: boolean;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  kind: 'low_stock' | 'request_new' | 'request_status' | 'document_ready' | 'count_due' | 'system';
  title: string;
  body: string | null;
  data: { request_id?: string; product_id?: string; document_id?: string };
  read_at: string | null;
  created_at: string;
};

export type DocumentRow = {
  id: string;
  tenant_id: string;
  source: 'ksef' | 'photo' | 'manual';
  status: 'processing' | 'draft' | 'verified' | 'posted' | 'failed';
  doc_kind: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_nip: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  currency: string;
  total_net: number | string | null;
  total_gross: number | string | null;
  file_paths: string[];
  page_count: number | null;
  error_message: string | null;
  ai_model: string | null;
  ai_confidence: number | null;
  ai_warnings: { code?: string; text: string }[];
  revision: number;
  created_by_name: string | null;
  posted_at: string | null;
  created_at: string;
  line_count: number;
  unmatched_count: number;
};

export type DocumentLineRow = {
  id: string;
  document_id: string;
  line_no: number;
  raw_name: string;
  qty: number | string;
  unit: string | null;
  unit_price_net: number | string | null;
  total_net: number | string | null;
  vat_rate: number | string | null;
  ean: string | null;
  product_id: string | null;
  match_confidence: number | null;
  ai_confidence: number | null;
  skip: boolean;
  project_id: string | null;
};

export type TeamMember = {
  membership_id: string;
  user_id: string;
  role: Role;
  can_manage_managers: boolean;
  can_manage_billing: boolean;
  display_name: string;
  email: string | null;
  created_at: string;
};

export type TeamInvite = {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  invited_by_name: string;
};

export type Project = { id: string; name: string; ref_number: string | null; type: string; status: 'open' | 'closed' };
export type Supplier = { id: string; name: string; nip: string | null };
