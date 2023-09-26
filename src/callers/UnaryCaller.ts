import type { JSONValue } from '../types';
import Caller from './Caller';

class UnaryCaller<
  Input extends JSONValue = JSONValue,
  Output extends JSONValue = JSONValue,
> extends Caller<Input, Output> {
  public type: 'UNARY' = 'UNARY' as const;
}

export default UnaryCaller;
