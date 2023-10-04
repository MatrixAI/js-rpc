import type { ContainerType, JSONValue } from '../types';
import type { ContextTimed } from '@matrixai/contexts';
import Handler from './Handler';
import { ErrorRPCMethodNotImplemented } from '../errors';

abstract class DuplexHandler<
  Container extends ContainerType = ContainerType,
  Input extends JSONValue = JSONValue,
  Output extends JSONValue = JSONValue,
> extends Handler<Container, Input, Output> {
  /**
   * Note that if the output has an error, the handler will not see this as an
   * error. If you need to handle any clean up it should be handled in a
   * `finally` block and check the abort signal for potential errors.
   */
  public async *handle(
    input: AsyncIterableIterator<Input>,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
  ): AsyncIterableIterator<Output> {
    throw new ErrorRPCMethodNotImplemented('This method must be overwrtitten.');
  }
}

export default DuplexHandler;
