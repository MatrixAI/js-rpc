import type { JSONValue } from '../types';
import Caller from './Caller';
class RawCaller extends Caller {
  public type: 'RAW' = 'RAW' as const;
}

export default RawCaller;
