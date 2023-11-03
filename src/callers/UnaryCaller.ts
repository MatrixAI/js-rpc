import type { JSONRPCRequestParams, JSONRPCResponseResult } from '../types';
import Caller from './Caller';

class UnaryCaller<
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'UNARY' = 'UNARY' as const;
}

export default UnaryCaller;
