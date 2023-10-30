import type { JSONObject, JSONRPCParams, JSONRPCResult } from '../types';
import Caller from './Caller';

class DuplexCaller<
  Input extends JSONObject = JSONRPCParams,
  Output extends JSONObject = JSONRPCResult,
> extends Caller<Input, Output> {
  public type: 'DUPLEX' = 'DUPLEX' as const;
}

export default DuplexCaller;
