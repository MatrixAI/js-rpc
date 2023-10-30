import type { JSONObject, JSONRPCParams, JSONRPCResult } from '../types';
import Caller from './Caller';

class ServerCaller<
  Input extends JSONObject = JSONRPCParams,
  Output extends JSONObject = JSONRPCResult,
> extends Caller<Input, Output> {
  public type: 'SERVER' = 'SERVER' as const;
}

export default ServerCaller;
