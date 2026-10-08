// Punkt wejścia (Deno). Cała logika: ./handler.ts, klej do Supabase/Anthropic: ../_shared/runtime.ts
import { buildProcessDeps } from '../_shared/runtime.ts';
import { handleProcessDocument } from './handler.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

Deno.serve((req) => handleProcessDocument(req, buildProcessDeps()));
