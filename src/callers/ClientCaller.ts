import type {
  JSONObject,
  JSONRPCRequestParams,
  JSONRPCResponseResult,
} from '../types';
import Caller from './Caller';

class ClientCaller<
  Input extends JSONObject = JSONRPCRequestParams,
  Output extends JSONObject = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'CLIENT' = 'CLIENT' as const;
}

export default ClientCaller;
