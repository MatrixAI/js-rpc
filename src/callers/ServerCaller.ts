import type { JSONRPCRequestParams, JSONRPCResponseResult } from '../types.js';
import Caller from './Caller.js';

class ServerCaller<
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'SERVER' = 'SERVER' as const;
}

export default ServerCaller;
