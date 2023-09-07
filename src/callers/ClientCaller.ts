import type { JSONValue } from '../types';
import Caller from './Caller';

class ClientCaller<
  Input extends JSONValue = JSONValue,
  Output extends JSONValue = JSONValue,
> extends Caller<Input, Output> {
  public type: 'CLIENT' = 'CLIENT' as const;
}

export default ClientCaller;
