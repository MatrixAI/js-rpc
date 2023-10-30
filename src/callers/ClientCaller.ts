import type { JSONObject, JSONRPCParams, JSONRPCResult } from '../types';
import Caller from './Caller';

class ClientCaller<
  Input extends JSONObject = JSONRPCParams,
  Output extends JSONObject = JSONRPCResult,
> extends Caller<Input, Output> {
  public type: 'CLIENT' = 'CLIENT' as const;
}

export default ClientCaller;
