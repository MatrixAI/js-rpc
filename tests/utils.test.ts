import { test, fc } from '@fast-check/jest';
import * as rpcUtils from '@/utils';
import 'ix/add/asynciterable-operators/toarray';
import * as rpcTestUtils from './utils';

describe('utils tests', () => {
  test.prop(
    {
      message: rpcTestUtils.jsonRpcMessageArb(),
    },
    { numRuns: 1000 },
  )('can parse messages', async ({ message }) => {
    rpcUtils.parseJSONRPCMessage(message);
  });
  test.prop(
    {
      message: fc.json(),
    },
    { numRuns: 1000 },
  )('malformed data cases parsing errors', async ({ message }) => {
    expect(() =>
      rpcUtils.parseJSONRPCMessage(Buffer.from(JSON.stringify(message))),
    ).toThrow();
  });
});
