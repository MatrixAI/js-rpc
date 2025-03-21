import Caller from './Caller.js';
class RawCaller extends Caller {
  public type: 'RAW' = 'RAW' as const;
}

export default RawCaller;
