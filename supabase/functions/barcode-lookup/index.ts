import { buildBarcodeDeps } from '../_shared/runtime.ts';
import { handleBarcodeLookup } from './handler.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

Deno.serve((req) => handleBarcodeLookup(req, buildBarcodeDeps()));
