import type { JSONRPCRequestParams, JSONRPCResponseResult } from '../types';
import Caller from './Caller';

class ServerCaller<
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'SERVER' = 'SERVER' as const;
}

export default ServerCaller;
