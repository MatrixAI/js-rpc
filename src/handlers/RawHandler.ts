import type { ContextTimed } from '@matrixai/contexts';
import type { ReadableStream } from 'stream/web';
import type { ContainerType, JSONRPCRequest, JSONValue } from '../types';
import Handler from './Handler';
import { ErrorRPCMethodNotImplemented } from '../errors';

abstract class RawHandler<
  Container extends ContainerType = ContainerType,
> extends Handler<Container> {
  public async handle(
    input: [JSONRPCRequest, ReadableStream<Uint8Array>],
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
  ): Promise<[JSONValue, ReadableStream<Uint8Array>]> {
    throw new ErrorRPCMethodNotImplemented('This method must be overridden');
  }
}

export default RawHandler;
