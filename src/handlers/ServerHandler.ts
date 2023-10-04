import type { ContextTimed } from '@matrixai/contexts';
import type { ContainerType, JSONValue } from '../types';
import Handler from './Handler';
import { ErrorRPCMethodNotImplemented } from '../errors';

abstract class ServerHandler<
  Container extends ContainerType = ContainerType,
  Input extends JSONValue = JSONValue,
  Output extends JSONValue = JSONValue,
> extends Handler<Container, Input, Output> {
  public async *handle(
    input: Input,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
  ): AsyncIterableIterator<Output> {
    throw new ErrorRPCMethodNotImplemented('This method must be overridden');
  }
}

export default ServerHandler;
