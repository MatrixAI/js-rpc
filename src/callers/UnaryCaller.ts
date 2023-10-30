import type { JSONObject, JSONRPCParams, JSONRPCResult } from '../types';
import Caller from './Caller';

class UnaryCaller<
  Input extends JSONObject = JSONRPCParams,
  Output extends JSONObject = JSONRPCResult,
> extends Caller<Input, Output> {
  public type: 'UNARY' = 'UNARY' as const;
}

export default UnaryCaller;
