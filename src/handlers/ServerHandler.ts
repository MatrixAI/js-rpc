import type { ContextTimed } from '@matrixai/contexts';
import type {
  ContainerType,
  JSONValue,
  JSONRPCParams,
  JSONRPCResult,
} from '../types';
import Handler from './Handler';
import { ErrorRPCMethodNotImplemented } from '../errors';

abstract class ServerHandler<
  Container extends ContainerType = ContainerType,
  Input extends JSONRPCParams = JSONRPCParams,
  Output extends JSONRPCResult = JSONRPCResult,
> extends Handler<Container, Input, Output> {
  public async *handle(
    /* eslint-disable */
    input: Input,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
    /* eslint-disable */
  ): AsyncIterableIterator<Output> {
    throw new ErrorRPCMethodNotImplemented('This method must be overridden');
  }
}

export default ServerHandler;
