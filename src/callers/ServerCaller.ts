import type { JSONValue } from '../types';
import Caller from './Caller';

class ServerCaller<
  Input extends JSONValue = JSONValue,
  Output extends JSONValue = JSONValue,
> extends Caller<Input, Output> {
  public type: 'SERVER' = 'SERVER' as const;
}

export default ServerCaller;
