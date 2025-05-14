import type {
  ContainerType,
  JSONValue,
  JSONRPCRequestParams,
  JSONRPCResponseResult,
} from '../types.js';
import type { ContextTimed } from '@matrixai/contexts';
import Handler from './Handler.js';
import { ErrorRPCMethodNotImplemented } from '../errors.js';

abstract class ClientHandler<
  Container extends ContainerType = ContainerType,
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> extends Handler<Container, Input, Output> {
  public async handle(
    /* eslint-disable */
    input: AsyncIterableIterator<Input>,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
     
  ): Promise<Output> {
    throw new ErrorRPCMethodNotImplemented();
  }
}

export default ClientHandler;
