import type { HandlerType, JSONValue } from '../types';

abstract class Caller<
  Input extends JSONValue = JSONValue,
  Output extends JSONValue = JSONValue,
> {
  protected _inputType: Input;
  protected _outputType: Output;
  // Need this to distinguish the classes when inferring types
  abstract type: HandlerType;
}

export default Caller;
