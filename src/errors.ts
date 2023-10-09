import type { Class } from '@matrixai/errors';
import type { JSONRPCError, JSONValue } from '@/types';
import { AbstractError } from '@matrixai/errors';

class ErrorRPC<T> extends AbstractError<T> {
  static description = 'RPC Error';
}

// Server Errors

class ErrorRPCServer<T> extends ErrorRPC<T> {
  static description = 'RPCServer error';
}

class ErrorRPCServerNotRunning<T> extends ErrorRPC<T> {
  static description = 'RPCServer is not running';
}

/**
 * This is an internal error, it should not reach the top level.
 */
class ErrorRPCHandlerFailed<T> extends ErrorRPC<T> {
  static description = 'Failed to handle stream';
}

class ErrorRPCCallerFailed<T> extends ErrorRPC<T> {
  static description = 'Failed to call stream';
}

abstract class ErrorRPCProtocol<T> extends ErrorRPC<T> {
  static error = 'RPC Protocol Error';
  code: number;

  public static fromJSON<T extends Class<any>>(json: any): InstanceType<T> {
    if (
      typeof json !== 'object' ||
      typeof json.code !== 'number' ||
      typeof json.message !== 'string' ||
      typeof json.data !== 'object'
    ) {
      return new ErrorRPCUnknown<T>(
        `Cannot decode JSON to ${this.name}`,
      ) as InstanceType<T>;
    }

    const errorC = rpcProtocolErrors[json.code];

    if (errorC == null) {
      return new ErrorRPCUnknown<T>(
        `Unknown error.code found on RPC message`,
      ) as InstanceType<T>;
    }

    const e: InstanceType<T> = new errorC(json.message);

    e.stack = json.data.stack;
    e.data = json.data.data;
    e.timestamp = new Date(json.data.timestamp);

    return e;
  }
  /**
   * The return type WILL NOT include cause, this will be handled by `fromError`
   * @returns
   */
  public toJSON(): JSONRPCError {
    return {
      code: this.code,
      message: this.message,
      data: {
        timestamp: this.timestamp.toJSON(),
        data: this.data,
        stack: this.stack,
      },
    };
  }
}

class ErrorRPCParse<T> extends ErrorRPCProtocol<T> {
  static description = 'Failed to parse Buffer stream';
  code = JSONRPCErrorCode.ParseError;
}

class ErrorRPCInvalidParams<T> extends ErrorRPCProtocol<T> {
  static description = 'Invalid paramaters provided to RPC';
  code = JSONRPCErrorCode.InvalidParams;
}

class ErrorRPCStopping<T> extends ErrorRPCProtocol<T> {
  static description = 'RPC is stopping';
  code = JSONRPCErrorCode.RPCStopping;
}

class ErrorMissingCaller<T> extends ErrorRPCProtocol<T> {
  static description = 'Caller is missing';
  code = JSONRPCErrorCode.MissingCaller;
}
class ErrorMissingHeader<T> extends ErrorRPCProtocol<T> {
  static description = 'Header information is missing';
  code = JSONRPCErrorCode.MissingHeader;
}

class ErrorHandlerAborted<T> extends ErrorRPCProtocol<T> {
  static description = 'Handler Aborted Stream';
  code = JSONRPCErrorCode.HandlerAborted;
}

class ErrorRPCMessageLength<T> extends ErrorRPCProtocol<T> {
  static description = 'RPC Message exceeds maximum size';
  code = JSONRPCErrorCode.RPCMessageLength;
}

class ErrorRPCMissingResponse<T> extends ErrorRPCProtocol<T> {
  static description = 'Stream ended before response';
  code = JSONRPCErrorCode.RPCMissingResponse;
}

class ErrorRPCOutputStreamError<T> extends ErrorRPCProtocol<T> {
  static description = 'Output stream failed, unable to send data';
  code = JSONRPCErrorCode.RPCOutputStreamError;
}

class ErrorRPCRemote<T> extends ErrorRPCProtocol<T> {
  static description = 'Remote error from RPC call';
  static message: string = 'The server responded with an error';
  metadata: JSONValue = {};
  code = JSONRPCErrorCode.RPCRemote;
}

class ErrorRPCStreamEnded<T> extends ErrorRPCProtocol<T> {
  static description = 'Handled stream has ended';
  code = JSONRPCErrorCode.RPCStreamEnded;
}

class ErrorRPCTimedOut<T> extends ErrorRPCProtocol<T> {
  static description = 'RPC handler has timed out';
  code = JSONRPCErrorCode.RPCTimedOut;
}

class ErrorUtilsUndefinedBehaviour<T> extends ErrorRPCProtocol<T> {
  static description = 'You should never see this error';
  code = JSONRPCErrorCode.MethodNotFound;
}

class ErrorRPCMethodNotImplemented<T> extends ErrorRPCProtocol<T> {
  static description =
    'This abstract method must be implemented in a derived class';
  code = JSONRPCErrorCode.MethodNotFound;
}

class ErrorRPCConnectionLocal<T> extends ErrorRPCProtocol<T> {
  static description = 'RPC Connection local error';
  code = JSONRPCErrorCode.RPCConnectionLocal;
}

class ErrorRPCConnectionPeer<T> extends ErrorRPCProtocol<T> {
  static description = 'RPC Connection peer error';
  code = JSONRPCErrorCode.RPCConnectionPeer;
}

class ErrorRPCConnectionKeepAliveTimeOut<T> extends ErrorRPCProtocol<T> {
  static description = 'RPC Connection keep alive timeout';
  code = JSONRPCErrorCode.RPCConnectionKeepAliveTimeOut;
}

class ErrorRPCConnectionInternal<T> extends ErrorRPCProtocol<T> {
  static description = 'RPC Connection internal error';
  code = JSONRPCErrorCode.RPCConnectionInternal;
}

class ErrorRPCUnknown<T> extends ErrorRPCProtocol<T> {
  static description = 'RPC Unknown Error';
  code = 0;
}

const enum JSONRPCErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  HandlerNotFound = -32000,
  RPCStopping = -32001,
  RPCMessageLength = -32003,
  RPCMissingResponse = -32004,
  RPCOutputStreamError = -32005,
  RPCRemote = -32006,
  RPCStreamEnded = -32007,
  RPCTimedOut = -32008,
  RPCConnectionLocal = -32010,
  RPCConnectionPeer = -32011,
  RPCConnectionKeepAliveTimeOut = -32012,
  RPCConnectionInternal = -32013,
  MissingHeader = -32014,
  HandlerAborted = -32015,
  MissingCaller = -32016,
}

const rpcProtocolErrors = {
  [JSONRPCErrorCode.RPCRemote]: ErrorRPCRemote,
  [JSONRPCErrorCode.RPCStopping]: ErrorRPCStopping,
  [JSONRPCErrorCode.RPCMessageLength]: ErrorRPCMessageLength,
  [JSONRPCErrorCode.ParseError]: ErrorRPCParse,
  [JSONRPCErrorCode.InvalidParams]: ErrorRPCInvalidParams,
  [JSONRPCErrorCode.HandlerNotFound]: ErrorRPCHandlerFailed,
  [JSONRPCErrorCode.RPCMissingResponse]: ErrorRPCMissingResponse,
  [JSONRPCErrorCode.RPCOutputStreamError]: ErrorRPCOutputStreamError,
  [JSONRPCErrorCode.RPCTimedOut]: ErrorRPCTimedOut,
  [JSONRPCErrorCode.RPCStreamEnded]: ErrorRPCStreamEnded,
  [JSONRPCErrorCode.RPCConnectionLocal]: ErrorRPCConnectionLocal,
  [JSONRPCErrorCode.RPCConnectionPeer]: ErrorRPCConnectionPeer,
  [JSONRPCErrorCode.RPCConnectionKeepAliveTimeOut]:
    ErrorRPCConnectionKeepAliveTimeOut,
  [JSONRPCErrorCode.RPCConnectionInternal]: ErrorRPCConnectionInternal,
  [JSONRPCErrorCode.MissingHeader]: ErrorMissingHeader,
  [JSONRPCErrorCode.HandlerAborted]: ErrorRPCHandlerFailed,
  [JSONRPCErrorCode.MissingCaller]: ErrorMissingCaller,
};

export {
  ErrorRPC,
  ErrorRPCServer,
  ErrorRPCServerNotRunning,
  ErrorRPCProtocol,
  ErrorRPCStopping,
  ErrorRPCParse,
  ErrorRPCInvalidParams,
  ErrorRPCHandlerFailed,
  ErrorRPCMessageLength,
  ErrorRPCMissingResponse,
  ErrorRPCOutputStreamError,
  ErrorRPCRemote,
  ErrorRPCStreamEnded,
  ErrorRPCTimedOut,
  ErrorUtilsUndefinedBehaviour,
  ErrorRPCMethodNotImplemented,
  ErrorRPCConnectionLocal,
  ErrorRPCConnectionPeer,
  ErrorRPCConnectionKeepAliveTimeOut,
  ErrorRPCConnectionInternal,
  ErrorMissingHeader,
  ErrorHandlerAborted,
  ErrorRPCCallerFailed,
  ErrorMissingCaller,
  ErrorRPCUnknown,
  JSONRPCErrorCode,
  rpcProtocolErrors,
};
