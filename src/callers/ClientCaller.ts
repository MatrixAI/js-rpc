import type { JSONRPCRequestParams, JSONRPCResponseResult } from '../types.js';
import Caller from './Caller.js';

class ClientCaller<
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'CLIENT' = 'CLIENT' as const;
}

export default ClientCaller;
