import type { JSONValue } from '../types';
import Caller from './Caller';

class DuplexCaller<
  Input extends JSONValue = JSONValue,
  Output extends JSONValue = JSONValue,
> extends Caller<Input, Output> {
  public type: 'DUPLEX' = 'DUPLEX' as const;
}

export default DuplexCaller;
