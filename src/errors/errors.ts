import type { Class } from '@matrixai/errors';
import type { JSONValue } from '@/types';
import sysexits from './sysexits';

interface RPCError extends Error {
  exitCode?: number;
}

class ErrorRPC<T> extends Error implements RPCError {
  constructor(message?: string) {
    super(message);
    this.name = 'ErrorRPC';
    this.description = 'Generic Error';
  }
  exitCode?: number;
  description?: string;

}

class ErrorRPCDestroyed<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message); // Call the parent constructor
    this.name = 'ErrorRPCDestroyed'; // Optionally set a specific name
    this.description = 'Rpc is destroyed'; // Set the specific description
    this.exitCode = sysexits.USAGE; // Set the exit code
  }
}

class ErrorRPCParse<T> extends ErrorRPC<T> {
  static description = 'Failed to parse Buffer stream';
  exitCode = sysexits.SOFTWARE;
  cause: Error | undefined; // Added this line to hold the cause

  constructor(message?: string, options?: { cause: Error }) {
    super(message); // Call the parent constructor
    this.name = 'ErrorRPCParse'; // Optionally set a specific name
    this.description = 'Failed to parse Buffer stream'; // Set the specific description
    this.exitCode = sysexits.SOFTWARE; // Set the exit code

    // Set the cause if provided in options
    if (options && options.cause) {
      this.cause = options.cause;
    }
  }
}

class ErrorRPCStopping<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message); // Call the parent constructor
    this.name = 'ErrorRPCStopping'; // Optionally set a specific name
    this.description = 'Rpc is stopping'; // Set the specific description
    this.exitCode = sysexits.USAGE; // Set the exit code
  }
}

/**
 * This is an internal error, it should not reach the top level.
 */
class ErrorRPCHandlerFailed<T> extends ErrorRPC<T> {
  cause: Error | undefined;

  constructor(message?: string, options?: { cause: Error }) {
    super(message); // Call the parent constructor
    this.name = 'ErrorRPCHandlerFailed'; // Optionally set a specific name
    this.description = 'Failed to handle stream'; // Set the specific description
    this.exitCode = sysexits.SOFTWARE; // Set the exit code

    // Set the cause if provided in options
    if (options && options.cause) {
      this.cause = options.cause;
    }
  }
}

class ErrorRPCMessageLength<T> extends ErrorRPC<T> {
  static description = 'RPC Message exceeds maximum size';
  exitCode = sysexits.DATAERR;
}

class ErrorRPCMissingResponse<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message);
    this.name = 'ErrorRPCMissingResponse';
    this.description = 'Stream ended before response';
    this.exitCode = sysexits.UNAVAILABLE;
  }
}

interface ErrorRPCOutputStreamErrorOptions {
  cause?: Error;
  // ... other properties
}
class ErrorRPCOutputStreamError<T> extends ErrorRPC<T> {
  cause?: Error;

  constructor(message: string, options: ErrorRPCOutputStreamErrorOptions) {
    super(message);
    this.name = 'ErrorRPCOutputStreamError';
    this.description = 'Output stream failed, unable to send data';
    this.exitCode = sysexits.UNAVAILABLE;

    // Set the cause if provided in options
    if (options && options.cause) {
      this.cause = options.cause;
    }
  }
}

class ErrorRPCRemote<T> extends ErrorRPC<T> {
  static description = 'Remote error from RPC call';
  exitCode: number = sysexits.UNAVAILABLE;
  metadata: JSONValue | undefined;

  constructor(metadata?: JSONValue, message?: string, options?) {
    super(message);
    this.name = 'ErrorRPCRemote';
    this.metadata = metadata;
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
      typeof json.data.exitCode !== 'number' ||
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
    e.exitCode = json.data.exitCode;
    e.stack = json.data.stack;
    return e;
  }
  public toJSON(): any {
    return {
      type: this.name,
      data: {
        description: this.description,
        exitCode: this.exitCode,
      },
    };
  }
}

class ErrorRPCStreamEnded<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message);
    this.name = 'ErrorRPCStreamEnded';
    this.description = 'Handled stream has ended';
    this.exitCode = sysexits.NOINPUT;
  }
}

class ErrorRPCTimedOut<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message);
    this.name = 'ErrorRPCTimedOut';
    this.description = 'RPC handler has timed out';
    this.exitCode = sysexits.UNAVAILABLE;
  }
}

class ErrorUtilsUndefinedBehaviour<T> extends ErrorRPC<T> {
  constructor(message?: string) {
    super(message);
    this.name = 'ErrorUtilsUndefinedBehaviour';
    this.description = 'You should never see this error';
    this.exitCode = sysexits.SOFTWARE;
  }
}
export function never(): never {
  throw new ErrorRPC('This function should never be called');
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
};
