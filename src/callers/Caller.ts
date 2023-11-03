import type {
  HandlerType,
  JSONRPCRequestParams,
  JSONRPCResponseResult,
} from '../types';

abstract class Caller<
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> {
  protected _inputType: Input;
  protected _outputType: Output;
  // Need this to distinguish the classes when inferring types
  abstract type: HandlerType;
}

export default Caller;
