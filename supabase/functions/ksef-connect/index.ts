import { buildKsefConnectDeps } from '../_shared/runtime.ts';
import { handleKsefConnect } from './handler.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

Deno.serve((req) => handleKsefConnect(req, buildKsefConnectDeps()));
