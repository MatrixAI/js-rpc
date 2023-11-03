import type { JSONRPCRequestParams, JSONRPCResponseResult } from '../types';
import Caller from './Caller';

class ClientCaller<
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'CLIENT' = 'CLIENT' as const;
}

export default ClientCaller;
