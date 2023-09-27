import type { ContainerType, JSONValue } from '../types';
import type { ContextTimed } from '@matrixai/contexts';
import Handler from './Handler';
import { ErrorRPCMethodNotImplemented } from '../errors';

abstract class ClientHandler<
  Container extends ContainerType = ContainerType,
  Input extends JSONValue = JSONValue,
  Output extends JSONValue = JSONValue,
> extends Handler<Container, Input, Output> {
  public handle = async function* (
    input: AsyncIterableIterator<Input>,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
  ): AsyncIterableIterator<Output> {
    throw new ErrorRPCMethodNotImplemented();
  };
}

export default ClientHandler;
