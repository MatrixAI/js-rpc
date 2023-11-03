import type { ContextTimed } from '@matrixai/contexts';
import type {
  ContainerType,
  JSONValue,
  JSONRPCRequestParams,
  JSONRPCResponseResult,
} from '../types';
import Handler from './Handler';
import { ErrorRPCMethodNotImplemented } from '../errors';

abstract class UnaryHandler<
  Container extends ContainerType = ContainerType,
  Input extends JSONRPCRequestParams = JSONRPCRequestParams,
  Output extends JSONRPCResponseResult = JSONRPCResponseResult,
> extends Handler<Container, Input, Output> {
  public async handle(
    /* eslint-disable */
    input: Input,
    cancel: (reason?: any) => void,
    meta: Record<string, JSONValue> | undefined,
    ctx: ContextTimed,
    /* eslint-disable */
  ): Promise<Output> {
    throw new ErrorRPCMethodNotImplemented('This method must be overridden');
  }
}

export default UnaryHandler;
