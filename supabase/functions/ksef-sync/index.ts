import { buildKsefSyncDeps } from '../_shared/runtime.ts';
import { handleKsefSync } from './handler.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

Deno.serve((req) => handleKsefSync(req, buildKsefSyncDeps()));
