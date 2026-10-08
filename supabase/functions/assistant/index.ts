import { buildAssistantDeps } from '../_shared/runtime.ts';
import { handleAssistant } from './handler.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

Deno.serve((req) => handleAssistant(req, buildAssistantDeps()));
