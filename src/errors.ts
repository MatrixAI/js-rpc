import type { Class } from '@matrixai/errors';
import type { JSONValue } from '@/types';
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

// Protocol Errors

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

abstract class ErrorRPCProtocol<T> extends ErrorRPC<T> {
  static error = 'RPC Protocol Error';
  code: number;
  type: string;
}

class ErrorRPCParse<T> extends ErrorRPCProtocol<T> {
  static description = 'Failed to parse Buffer stream';
  code = JSONRPCErrorCode.ParseError;
}

class ErrorRPCStopping<T> extends ErrorRPCProtocol<T> {
  static description = 'RPC is stopping';
  code = JSONRPCErrorCode.RPCStopping;
}

/**
 * This is an internal error, it should not reach the top level.
 */
class ErrorRPCHandlerFailed<T> extends ErrorRPCProtocol<T> {
  static description = 'Failed to handle stream';
  code = JSONRPCErrorCode.HandlerNotFound;
}

class ErrorRPCCallerFailed<T> extends ErrorRPCProtocol<T> {
  static description = 'Failed to call stream';
  code = JSONRPCErrorCode.MissingCaller;
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
  metadata: JSONValue | undefined;

  constructor({
    metadata,
    message,
    options,
  }: {
    metadata?: JSONValue;
    message?: string;
    options?: any;
  } = {}) {
    super(message, options);
    this.metadata = metadata;
    this.code = JSONRPCErrorCode.RPCRemote;
    this.data = options?.data;
    this.type = this.constructor.name;
    this.message = message || ErrorRPCRemote.message;
  }

  public static fromJSON<T extends Class<any>>(
    this: T,
    json: any,
  ): InstanceType<T> {
    if (
      typeof json !== 'object' ||
      json.type !== this.name ||
      typeof json.data !== 'object' ||
      typeof json.data.message !== 'string' ||
      isNaN(Date.parse(json.data.timestamp)) ||
      typeof json.data.metadata !== 'object' ||
      typeof json.data.data !== 'object' ||
      ('stack' in json.data && typeof json.data.stack !== 'string')
    ) {
      throw new TypeError(`Cannot decode JSON to ${this.name}`);
    }

    // Here, you can define your own metadata object, or just use the one from JSON directly.
    const parsedMetadata = json.data.metadata;

    const e = new this(parsedMetadata, json.data.message, {
      timestamp: new Date(json.data.timestamp),
      data: json.data.data,
      cause: json.data.cause,
    });
    e.stack = json.data.stack;
    return e;
  }
  public toJSON(): any {
    return {
      type: this.name,
      data: {
        description: this.description,
      },
    };
  }
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

export {
  ErrorRPC,
  ErrorRPCServer,
  ErrorRPCServerNotRunning,
  ErrorRPCProtocol,
  ErrorRPCStopping,
  ErrorRPCParse,
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
  JSONRPCErrorCode,
};
