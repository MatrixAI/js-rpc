import type {
  JSONObject,
  JSONRPCRequestParams,
  JSONRPCResponseResult,
} from '../types';
import Caller from './Caller';

class DuplexCaller<
  Input extends JSONObject = JSONRPCRequestParams,
  Output extends JSONObject = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'DUPLEX' = 'DUPLEX' as const;
}

export default DuplexCaller;
