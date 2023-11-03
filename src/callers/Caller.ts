import type {
  HandlerType,
  JSONObject,
  JSONRPCRequestParams,
  JSONRPCResponseResult,
} from '../types';

abstract class Caller<
  Input extends JSONObject = JSONRPCRequestParams,
  Output extends JSONObject = JSONRPCResponseResult,
> {
  protected _inputType: Input;
  protected _outputType: Output;
  // Need this to distinguish the classes when inferring types
  abstract type: HandlerType;
}

export default Caller;
