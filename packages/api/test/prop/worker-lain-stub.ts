import type { GetSnapshotArgs, GetSnapshotResponse } from '@parallax/shared/lain';
import { createLainMock } from '../../src/lain-adapter/mock.js';
import type { LainAdapter } from '../../src/lain-adapter/types.js';

/**
 * Stub rápido para tests stateful: conserva prepareSnapshot del mock (los ids
 * de snapshot siguen eligiendo el escenario) pero responde getSnapshot como
 * 'ready' al instante, para que awaitSnapshot no duerma 200ms por vista.
 */
export function createInstantLain(): LainAdapter {
  const mock = createLainMock();
  return {
    ...mock,
    async getSnapshot(req: GetSnapshotArgs): Promise<GetSnapshotResponse> {
      return { snapshot: req.snapshot, state: 'ready' };
    },
  };
}
