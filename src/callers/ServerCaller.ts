import type {
  JSONObject,
  JSONRPCRequestParams,
  JSONRPCResponseResult,
} from '../types';
import Caller from './Caller';

class ServerCaller<
  Input extends JSONObject = JSONRPCRequestParams,
  Output extends JSONObject = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'SERVER' = 'SERVER' as const;
}

export default ServerCaller;
