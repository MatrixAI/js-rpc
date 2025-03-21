import type { JSONRPCRequestParams, JSONRPCResponseResult } from '../types.js';
import Caller from './Caller.js';

class DuplexCaller<
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'DUPLEX' = 'DUPLEX' as const;
}

export default DuplexCaller;
