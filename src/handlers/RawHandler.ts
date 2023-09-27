import type { ContextTimed } from '@matrixai/contexts';
import type { ReadableStream } from 'stream/web';
import type { ContainerType, JSONRPCRequest, JSONValue } from '../types';
import Handler from './Handler';
import { ErrorRPCMethodNotImplemented } from '../errors';

abstract class RawHandler<
  Container extends ContainerType = ContainerType,
  Input extends JSONValue = JSONValue,  // Define Input type if needed
  Output extends JSONValue = JSONValue  // Define Output type if needed
> extends Handler<Container> {
  public handle = async function* (
    input: AsyncIterableIterator<Input>, // Change this based on your specific needs
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed
  ): AsyncIterableIterator<Output> {
    // Change return type to AsyncIterableIterator
    throw new ErrorRPCMethodNotImplemented('This method must be overridden');
  };
}

export default RawHandler;
