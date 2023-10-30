import type {
  HandlerType,
  JSONObject,
  JSONRPCParams,
  JSONRPCResult,
} from '../types';

abstract class Caller<
  Input extends JSONObject = JSONRPCParams,
  Output extends JSONObject = JSONRPCResult,
> {
  protected _inputType: Input;
  protected _outputType: Output;
  // Need this to distinguish the classes when inferring types
  abstract type: HandlerType;
}

export default Caller;
