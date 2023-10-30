import type {
  ContainerType,
  JSONValue,
  JSONRPCParams,
  JSONRPCResult,
} from '../types';
import type { ContextTimed } from '@matrixai/contexts';
import Handler from './Handler';
import { ErrorRPCMethodNotImplemented } from '../errors';

abstract class ClientHandler<
  Container extends ContainerType = ContainerType,
  Input extends JSONRPCParams = JSONRPCParams,
  Output extends JSONRPCResult = JSONRPCResult,
> extends Handler<Container, Input, Output> {
  public async handle(
    /* eslint-disable */
    input: AsyncIterableIterator<Input>,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
    /* eslint-disable */
  ): Promise<Output> {
    throw new ErrorRPCMethodNotImplemented();
  }
}

export default ClientHandler;
