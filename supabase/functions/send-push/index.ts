import { buildPushDeps, cronSecret } from '../_shared/runtime.ts';
import { handleSendPush } from './handler.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

Deno.serve((req) => handleSendPush(req, buildPushDeps(), cronSecret()));
