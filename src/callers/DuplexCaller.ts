import type { JSONRPCRequestParams, JSONRPCResponseResult } from '../types';
import Caller from './Caller';

class DuplexCaller<
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'DUPLEX' = 'DUPLEX' as const;
}

export default DuplexCaller;
