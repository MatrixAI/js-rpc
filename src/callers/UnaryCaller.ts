import type {
  JSONObject,
  JSONRPCRequestParams,
  JSONRPCResponseResult,
} from '../types';
import Caller from './Caller';

class UnaryCaller<
  Input extends JSONObject = JSONRPCRequestParams,
  Output extends JSONObject = JSONRPCResponseResult,
> extends Caller<Input, Output> {
  public type: 'UNARY' = 'UNARY' as const;
}

export default UnaryCaller;
