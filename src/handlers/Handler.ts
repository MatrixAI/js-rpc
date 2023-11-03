import type {
  ContainerType,
  JSONRPCRequestParams,
  JSONRPCResponseResult,
} from '../types';
abstract class Handler<
  Container extends ContainerType = ContainerType,
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> {
  // These are used to distinguish the handlers in the type system.
  // Without these the map types can't tell the types of handlers apart.
  protected _inputType: Input;
  protected _outputType: Output;
  /**
   * This is the timeout used for the handler.
   * If it is not set then the default timeout time for the `RPCServer` is used.
   */
  public timeout?: number;

  constructor(protected container: Container) {}
}
export default Handler;
