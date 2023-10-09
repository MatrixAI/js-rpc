import { testProp, fc } from '@fast-check/jest';
import { JSONParser } from '@streamparser/json';
import * as rpcUtils from '@/utils';
import 'ix/add/asynciterable-operators/toarray';
import * as rpcTestUtils from './utils';

describe('utils tests', () => {
  testProp(
    'can parse messages',
    [rpcTestUtils.jsonRpcMessageArb()],
    async (message) => {
      rpcUtils.parseJSONRPCMessage(message);
    },
    { numRuns: 1000 },
  );
  testProp(
    'malformed data cases parsing errors',
    [fc.json()],
    async (message) => {
      expect(() =>
        rpcUtils.parseJSONRPCMessage(Buffer.from(JSON.stringify(message))),
      ).toThrow();
    },
    { numRuns: 1000 },
  );
  test('fromError', () => {
    expect(rpcUtils.fromError(undefined)).toBe(undefined);
    expect(rpcUtils.fromError(null)).toBe(null);
    expect(rpcUtils.fromError("123")).toBe("123");
    expect(rpcUtils.fromError(123)).toBe(123);
    expect(rpcUtils.fromError(new Error("message"))).toHaveProperty("message", "message");
    expect(rpcUtils.fromError(new Error("message", { cause: new Error() }))).toHaveProperty(["cause", "type"], "Error");
  });
});
