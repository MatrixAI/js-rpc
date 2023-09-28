import type { Class } from '@matrixai/errors';
import type { JSONValue } from '@/types';
import { AbstractError } from '@matrixai/errors';

const enum JSONRPCErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  HandlerNotFound = -32000,
  RPCStopping = -32001,
  RPCDestroyed = -32002,
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
interface RPCError extends Error {
  code: number;
}
class ErrorRPC<T> extends AbstractError<T> implements RPCError {
  private _description: string = 'Generic Error';
  type: string;
  constructor(message?: string) {
    super(message);
    this.type = this.constructor.name;
  }
  code: number;

  get description(): string {
    return this._description;
  }

  set description(value: string) {
    this._description = value;
  }
}

class ErrorRPCDestroyed<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message); // Call the parent constructor
    this.description = 'Rpc is destroyed'; // Set the specific description
    this.code = JSONRPCErrorCode.MethodNotFound;
    this.type = this.constructor.name;
  }
}

class ErrorRPCParse<T> extends ErrorRPC<T> {
  static description = 'Failed to parse Buffer stream';

  constructor(message?: string, options?: { cause: Error }) {
    super(message); // Call the parent constructor
    this.description = 'Failed to parse Buffer stream'; // Set the specific description
    this.code = JSONRPCErrorCode.ParseError;
    this.type = this.constructor.name;
  }
}

class ErrorRPCStopping<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message); // Call the parent constructor
    this.description = 'Rpc is stopping'; // Set the specific description
    this.code = JSONRPCErrorCode.RPCStopping;
    this.type = this.constructor.name;
  }
}

/**
 * This is an internal error, it should not reach the top level.
 */
class ErrorRPCHandlerFailed<T> extends ErrorRPC<T> {
  constructor(message?: string, options?: { cause: Error }) {
    super(message); // Call the parent constructor
    this.description = 'Failed to handle stream'; // Set the specific description
    this.code = JSONRPCErrorCode.HandlerNotFound;
    this.type = this.constructor.name;
  }
}
class ErrorRPCCallerFailed<T> extends ErrorRPC<T> {
  constructor(message?: string, options?: { cause: Error }) {
    super(message); // Call the parent constructor
    this.description = 'Failed to call stream'; // Set the specific description
    this.code = JSONRPCErrorCode.MissingCaller;
    this.type = this.constructor.name;
  }
}
class ErrorMissingCaller<T> extends ErrorRPC<T> {
  constructor(message?: string, options?: { cause: Error }) {
    super(message); // Call the parent constructor
    this.description = 'Header information is missing'; // Set the specific description
    this.code = JSONRPCErrorCode.MissingCaller;
    this.type = this.constructor.name;
  }
}
class ErrorMissingHeader<T> extends ErrorRPC<T> {
  constructor(message?: string, options?: { cause: Error }) {
    super(message); // Call the parent constructor
    this.description = 'Header information is missing'; // Set the specific description
    this.code = JSONRPCErrorCode.MissingHeader;
    this.type = this.constructor.name;
  }
}

class ErrorHandlerAborted<T> extends ErrorRPC<T> {
  constructor(message?: string, options?: { cause: Error }) {
    super(message); // Call the parent constructor
    this.description = 'Handler Aborted Stream.'; // Set the specific description
    this.code = JSONRPCErrorCode.HandlerAborted;
    this.type = this.constructor.name;
  }
}
class ErrorRPCMessageLength<T> extends ErrorRPC<T> {
  static description = 'RPC Message exceeds maximum size';
  code = JSONRPCErrorCode.RPCMessageLength;
}

class ErrorRPCMissingResponse<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message);
    this.description = 'Stream ended before response';
    this.code = JSONRPCErrorCode.RPCMissingResponse;
    this.type = this.constructor.name;
  }
}

interface ErrorRPCOutputStreamErrorOptions {
  cause?: Error;
}
class ErrorRPCOutputStreamError<T> extends ErrorRPC<T> {
  constructor(message: string, options: ErrorRPCOutputStreamErrorOptions) {
    super(message);
    this.description = 'Output stream failed, unable to send data';
    this.code = JSONRPCErrorCode.RPCOutputStreamError;
    this.type = this.constructor.name;
  }
}

class ErrorRPCRemote<T> extends ErrorRPC<T> {
  static description = 'Remote error from RPC call';
  static message: string = 'The server responded with an error';
  metadata: JSONValue | undefined;

  constructor(metadata?: JSONValue, message?: string, options?) {
    super(message);
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

class ErrorRPCStreamEnded<T> extends ErrorRPC<T> {
  constructor(message?: string, options?: { cause: Error }) {
    super(message);
    this.description = 'Handled stream has ended';
    this.code = JSONRPCErrorCode.RPCStreamEnded;
    this.type = this.constructor.name;
  }
}

class ErrorRPCTimedOut<T> extends ErrorRPC<T> {
  constructor(message?: string, options?: { cause: Error }) {
    super(message);
    this.description = 'RPC handler has timed out';
    this.code = JSONRPCErrorCode.RPCTimedOut;
    this.type = this.constructor.name;
  }
}

class ErrorUtilsUndefinedBehaviour<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message);
    this.description = 'You should never see this error';
    this.code = JSONRPCErrorCode.MethodNotFound;
    this.type = this.constructor.name;
  }
}
export function never(): never {
  throw new ErrorRPC('This function should never be called');
}

class ErrorRPCMethodNotImplemented<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message || 'This method must be overridden'); // Default message if none provided
    this.name = 'ErrorRPCMethodNotImplemented';
    this.description =
      'This abstract method must be implemented in a derived class';
    this.code = JSONRPCErrorCode.MethodNotFound;
    this.type = this.constructor.name;
  }
}

class ErrorRPCConnectionLocal<T> extends ErrorRPC<T> {
  static description = 'RPC Connection local error';
  code = JSONRPCErrorCode.RPCConnectionLocal;
}

class ErrorRPCConnectionPeer<T> extends ErrorRPC<T> {
  static description = 'RPC Connection peer error';
  code = JSONRPCErrorCode.RPCConnectionPeer;
}

class ErrorRPCConnectionKeepAliveTimeOut<T> extends ErrorRPC<T> {
  static description = 'RPC Connection keep alive timeout';
  code = JSONRPCErrorCode.RPCConnectionKeepAliveTimeOut;
}

class ErrorRPCConnectionInternal<T> extends ErrorRPC<T> {
  static description = 'RPC Connection internal error';
  code = JSONRPCErrorCode.RPCConnectionInternal;
}

export {
  ErrorRPC,
  ErrorRPCDestroyed,
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
