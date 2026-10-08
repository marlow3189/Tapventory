import { adminClient, buildPushDeps, cronSecret } from '../_shared/runtime.ts';
import { handleCron } from './handler.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

Deno.serve((req) => {
  const admin = adminClient();
  return handleCron(
    req,
    {
      push: buildPushDeps(),
      db: {
        async rpc(name) {
          const { data, error } = await admin.rpc(name);
          if (error) throw error;
          return data;
        },
      },
      now: () => new Date(),
    },
    cronSecret()
  );
});
