import type { Timer } from '@matrixai/timer';
import type {
  ClientManifest,
  HandlerType,
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONValue,
  JSONRPCRequestMessage,
  JSONRPCRequestNotification,
  JSONRPCResponse,
  JSONRPCResponseError,
  JSONRPCResponseResult,
  PromiseDeconstructed,
} from './types';
import { TransformStream } from 'stream/web';
import { JSONParser } from '@streamparser/json';
import { AbstractError } from '@matrixai/errors';
import {
  ErrorRPCRemote,
  ErrorRPC,
  ErrorRPCConnectionInternal,
  ErrorRPCStopping,
  ErrorRPCMessageLength,
  ErrorRPCParse,
  ErrorRPCHandlerFailed,
  ErrorRPCMissingResponse,
  ErrorRPCOutputStreamError,
  ErrorRPCTimedOut,
  ErrorRPCStreamEnded,
  ErrorRPCConnectionLocal,
  ErrorRPCConnectionPeer,
  ErrorRPCConnectionKeepAliveTimeOut,
  ErrorMissingHeader,
  ErrorMissingCaller,
  ErrorRPCProtocol,
  ErrorRPCInvalidParams,
} from './errors';
import * as rpcErrors from './errors';

// Importing PK funcs and utils which are essential for RPC
function isObject(o: unknown): o is object {
  return o !== null && typeof o === 'object';
}
function promise<T = void>(): PromiseDeconstructed<T> {
  let resolveP, rejectP;
  const p = new Promise<T>((resolve, reject) => {
    resolveP = resolve;
    rejectP = reject;
  });
  return {
    p,
    resolveP,
    rejectP,
  };
}

async function sleep(ms: number): Promise<void> {
  return await new Promise<void>((r) => setTimeout(r, ms));
}

function parseJSONRPCRequest<T extends JSONValue>(
  message: unknown,
): JSONRPCRequest<T> {
  if (!isObject(message)) {
    throw new rpcErrors.ErrorRPCParse('must be a JSON POJO');
  }
  if (!('method' in message)) {
    throw new rpcErrors.ErrorRPCParse('`method` property must be defined');
  }
  if (typeof message.method !== 'string') {
    throw new rpcErrors.ErrorRPCParse('`method` property must be a string');
  }
  // If ('params' in message && !utils.isObject(message.params)) {
  //   throw new rpcErrors.ErrorRPCParse('`params` property must be a POJO');
  // }
  return message as JSONRPCRequest<T>;
}

function parseJSONRPCRequestMessage<T extends JSONValue>(
  message: unknown,
): JSONRPCRequestMessage<T> {
  const jsonRequest = parseJSONRPCRequest(message);
  if (!('id' in jsonRequest)) {
    throw new rpcErrors.ErrorRPCParse('`id` property must be defined');
  }
  if (
    typeof jsonRequest.id !== 'string' &&
    typeof jsonRequest.id !== 'number' &&
    jsonRequest.id !== null
  ) {
    throw new rpcErrors.ErrorRPCParse(
      '`id` property must be a string, number or null',
    );
  }
  return jsonRequest as JSONRPCRequestMessage<T>;
}

function parseJSONRPCRequestNotification<T extends JSONValue>(
  message: unknown,
): JSONRPCRequestNotification<T> {
  const jsonRequest = parseJSONRPCRequest(message);
  if ('id' in jsonRequest) {
    throw new rpcErrors.ErrorRPCParse('`id` property must not be defined');
  }
  return jsonRequest as JSONRPCRequestNotification<T>;
}

function parseJSONRPCResponseResult<T extends JSONValue>(
  message: unknown,
): JSONRPCResponseResult<T> {
  if (!isObject(message)) {
    throw new rpcErrors.ErrorRPCParse('must be a JSON POJO');
  }
  if (!('result' in message)) {
    throw new rpcErrors.ErrorRPCParse('`result` property must be defined');
  }
  if ('error' in message) {
    throw new rpcErrors.ErrorRPCParse('`error` property must not be defined');
  }
  // If (!utils.isObject(message.result)) {
  //   throw new rpcErrors.ErrorRPCParse('`result` property must be a POJO');
  // }
  if (!('id' in message)) {
    throw new rpcErrors.ErrorRPCParse('`id` property must be defined');
  }
  if (
    typeof message.id !== 'string' &&
    typeof message.id !== 'number' &&
    message.id !== null
  ) {
    throw new rpcErrors.ErrorRPCParse(
      '`id` property must be a string, number or null',
    );
  }
  return message as JSONRPCResponseResult<T>;
}

function parseJSONRPCResponseError(message: unknown): JSONRPCResponseError {
  if (!isObject(message)) {
    throw new rpcErrors.ErrorRPCParse('must be a JSON POJO');
  }
  if ('result' in message) {
    throw new rpcErrors.ErrorRPCParse('`result` property must not be defined');
  }
  if (!('error' in message)) {
    throw new rpcErrors.ErrorRPCParse('`error` property must be defined');
  }
  parseJSONRPCError(message.error);
  if (!('id' in message)) {
    throw new rpcErrors.ErrorRPCParse('`id` property must be defined');
  }
  if (
    typeof message.id !== 'string' &&
    typeof message.id !== 'number' &&
    message.id !== null
  ) {
    throw new rpcErrors.ErrorRPCParse(
      '`id` property must be a string, number or null',
    );
  }
  return message as JSONRPCResponseError;
}

function parseJSONRPCError(message: unknown): JSONRPCError {
  if (!isObject(message)) {
    throw new rpcErrors.ErrorRPCParse('must be a JSON POJO');
  }
  if (!('code' in message)) {
    throw new rpcErrors.ErrorRPCParse('`code` property must be defined');
  }
  if (typeof message.code !== 'number') {
    throw new rpcErrors.ErrorRPCParse('`code` property must be a number');
  }
  if (!('message' in message)) {
    throw new rpcErrors.ErrorRPCParse('`message` property must be defined');
  }
  if (typeof message.message !== 'string') {
    throw new rpcErrors.ErrorRPCParse('`message` property must be a string');
  }
  // If ('data' in message && !utils.isObject(message.data)) {
  //   throw new rpcErrors.ErrorRPCParse('`data` property must be a POJO');
  // }
  return message as JSONRPCError;
}

function parseJSONRPCResponse<T extends JSONValue>(
  message: unknown,
): JSONRPCResponse<T> {
  if (!isObject(message)) {
    throw new rpcErrors.ErrorRPCParse('must be a JSON POJO');
  }
  try {
    return parseJSONRPCResponseResult(message);
  } catch (e) {
    // Do nothing
  }
  try {
    return parseJSONRPCResponseError(message);
  } catch (e) {
    // Do nothing
  }
  throw new rpcErrors.ErrorRPCParse(
    'structure did not match a `JSONRPCResponse`',
  );
}

function parseJSONRPCMessage<T extends JSONValue>(
  message: unknown,
): JSONRPCMessage<T> {
  if (!isObject(message)) {
    throw new rpcErrors.ErrorRPCParse('must be a JSON POJO');
  }
  if (!('jsonrpc' in message)) {
    throw new rpcErrors.ErrorRPCParse('`jsonrpc` property must be defined');
  }
  if (message.jsonrpc !== '2.0') {
    throw new rpcErrors.ErrorRPCParse(
      '`jsonrpc` property must be a string of "2.0"',
    );
  }
  try {
    return parseJSONRPCRequest(message);
  } catch {
    // Do nothing
  }
  try {
    return parseJSONRPCResponse(message);
  } catch {
    // Do nothing
  }
  throw new rpcErrors.ErrorRPCParse(
    'Message structure did not match a `JSONRPCMessage`',
  );
}
/**
 * Serializes an Error instance into a JSONValue object suitable for RPC.
 * @param {Error} error - The Error instance to serialize.
 * @returns {JSONValue} The serialized ErrorRPC instance.
 */
function fromError(
  error: any,
): JSONValue {
  // TODO: Linked-List traversal must be done iteractively rather than recusively to prevent stack overflow.
  switch (typeof error) {
    case "symbol":
    case "bigint":
    case "function":
      throw TypeError(`${error} cannot be serialized`);
  }

  if (error instanceof Error) {
    const cause = fromError(error.cause);
    const timestamp: string = ((error as any).timestamp ?? new Date()).toJSON();
    if (error instanceof AbstractError) {
      return error.toJSON();
    }
    else if (error instanceof AggregateError) {
      // AggregateError has an `errors` property
      return {
        type: error.constructor.name,
        errors: error.errors.map(fromError),
        message: error.message,
        stack: error.stack,
        timestamp,
        cause
      };
    }

    // If it's some other type of error then only serialise the message and
    // stack (and the type of the error)
    return {
      type: error.name,
      message: error.message,
      stack: error.stack,
      timestamp,
      cause,
    };
  }

  return error;
}

/**
 * Error constructors for non-Polykey rpcErrors
 * Allows these rpcErrors to be reconstructed from RPC metadata
 */
const standardErrors: { [key: string]: typeof Error | typeof AggregateError | typeof AbstractError } = {
  Error,
  TypeError,
  SyntaxError,
  ReferenceError,
  EvalError,
  RangeError,
  URIError,
  AggregateError,
  AbstractError,
};

/**
 * The replacer function to customize the serialization process.
 */
const filterSensitive = (keyToRemove) => {
  return (key, value) => {
    if (key === keyToRemove) {
      return undefined;
    }

    if (key !== 'code') {
      if (value instanceof rpcErrors.ErrorRPCProtocol) {
        return {
          code: value.code,
          message: value.message,
          data: value.data,
          type: value.constructor.name,
        };
      }

      if (value instanceof AggregateError) {
        return {
          type: value.constructor.name,
          data: {
            errors: value.errors,
            message: value.message,
            stack: value.stack,
          },
        };
      }
    }

    return value;
  };
};

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

/**
 * Deserializes an error response object into an ErrorRPCRemote instance.
 * @param {any} errorResponse - The error response object.
 * @returns {ErrorRPCRemote<any>} The deserialized ErrorRPCRemote instance.
 * @throws {TypeError} If the errorResponse object is invalid.
 */

function toError(errorData: JSONValue, metadata: JSONValue): any {
  // If the value is an error then reconstruct it
  if (
    errorData != null &&
    typeof errorData === 'object' &&
    'type' in errorData &&
    typeof errorData.type === 'string'
  ) {
    try {
      let eClass = standardErrors[errorData.type];
      if (eClass != null) {
        let e: Error;
        switch (eClass) {
          case AbstractError:
            e = eClass.fromJSON(errorData);
            break;
          case AggregateError:
            if (
              !Array.isArray(errorData.errors) ||
              typeof errorData.message !== 'string' ||
              ('stack' in errorData && typeof errorData.stack !== 'string')
            ) {
              throw new TypeError(`cannot decode JSON to ${errorData.type}`);
            }
            e = new eClass(errorData.errors.map(toError), errorData.message);
            e.stack = errorData.stack as string;
            break;
          default:
            if (
              typeof errorData.message !== 'string' ||
              ('stack' in errorData && typeof errorData.stack !== 'string')
            ) {
              throw new TypeError(`Cannot decode JSON to ${errorData.type}`);
            }
            e = new (eClass as typeof Error)(errorData.message);
            e.stack = errorData.stack as string;
            break;
        }
        if ((e as any).data == null) {
          (e as any).data = {};
        }
        Object.assign((e as any).data, metadata);
        Object.assign((e as any).data, errorData);
        return e;
      }
    } catch (e) {
      // If `TypeError` which represents decoding failure
      // then return value as-is
      // Any other exception is a bug
      if (!(e instanceof TypeError)) {
        throw e;
      }
    }
  }
  // Other values are returned as-is
  return errorData;
}

/**
 * This constructs a transformation stream that converts any input into a
 * JSONRCPRequest message. It also refreshes a timer each time a message is processed if
 * one is provided.
 * @param method - Name of the method that was called, used to select the
 * server side.
 * @param timer - Timer that gets refreshed each time a message is provided.
 */
function clientInputTransformStream<I extends JSONValue>(
  method: string,
  timer?: Timer,
): TransformStream<I, JSONRPCRequest> {
  return new TransformStream<I, JSONRPCRequest>({
    transform: (chunk, controller) => {
      timer?.refresh();
      const message: JSONRPCRequest = {
        method,
        jsonrpc: '2.0',
        id: null,
        params: chunk,
      };
      controller.enqueue(message);
    },
  });
}

/**
 * This constructs a transformation stream that converts any error messages
 * into rpcErrors. It also refreshes a timer each time a message is processed if
 * one is provided.
 * @param clientMetadata - Metadata that is attached to an error when one is
 * created.
 * @param timer - Timer that gets refreshed each time a message is provided.
 */
function clientOutputTransformStream<O extends JSONValue>(
  clientMetadata: JSONValue,
  timer?: Timer,
): TransformStream<JSONRPCResponse<O>, O> {
  return new TransformStream<JSONRPCResponse<O>, O>({
    transform: (chunk, controller) => {
      timer?.refresh();
      // `error` indicates it's an error message
      if ('error' in chunk) {
        if (chunk.error.code === JSONRPCErrorCode.RPCRemote) {
          throw toError(JSON.parse(chunk.error.data as string), clientMetadata);
        }
        const e = ErrorRPCProtocol.fromJSON(chunk.error);
        Object.assign(e.data, clientMetadata);
        throw e;
      }
      controller.enqueue(chunk.result);
    },
  });
}

function getHandlerTypes(
  manifest: ClientManifest,
): Record<string, HandlerType> {
  const out: Record<string, HandlerType> = {};
  for (const [k, v] of Object.entries(manifest)) {
    out[k] = v.type;
  }
  return out;
}

/**
 * This function is a factory to create a TransformStream that will
 * transform a `Uint8Array` stream to a JSONRPC message stream.
 * The parsed messages will be validated with the provided messageParser, this
 * also infers the type of the stream output.
 * @param messageParser - Validates the JSONRPC messages, so you can select for a
 *  specific type of message
 * @param bufferByteLimit - sets the number of bytes buffered before throwing an
 *  error. This is used to avoid infinitely buffering the input.
 */
function parseHeadStream<T extends JSONRPCMessage>(
  messageParser: (message: unknown) => T,
  bufferByteLimit: number = 1024 * 1024,
): TransformStream<Uint8Array, T | Uint8Array> {
  const parser = new JSONParser({
    separator: '',
    paths: ['$'],
  });
  let bytesWritten: number = 0;
  let parsing = true;
  let ended = false;

  const endP = promise();
  parser.onEnd = () => endP.resolveP();

  return new TransformStream<Uint8Array, T | Uint8Array>(
    {
      flush: async () => {
        if (!parser.isEnded) parser.end();
        await endP.p;
      },
      start: (controller) => {
        parser.onValue = async (value) => {
          const jsonMessage = messageParser(value.value);
          controller.enqueue(jsonMessage);
          bytesWritten = 0;
          parsing = false;
        };
      },
      transform: async (chunk, controller) => {
        if (parsing) {
          try {
            bytesWritten += chunk.byteLength;
            parser.write(chunk);
          } catch (e) {
            throw new rpcErrors.ErrorRPCParse(undefined, {
              cause: e,
            });
          }
          if (bytesWritten > bufferByteLimit) {
            throw new rpcErrors.ErrorRPCMessageLength();
          }
        } else {
          // Wait for parser to end
          if (!ended) {
            parser.end();
            await endP.p;
            ended = true;
          }
          // Pass through normal chunks
          controller.enqueue(chunk);
        }
      },
    },
    { highWaterMark: 1 },
  );
}

function never(): never {
  throw new ErrorRPC('This function should never be called');
}

export {
  parseJSONRPCRequest,
  parseJSONRPCRequestMessage,
  parseJSONRPCRequestNotification,
  parseJSONRPCResponseResult,
  parseJSONRPCResponseError,
  parseJSONRPCResponse,
  parseJSONRPCMessage,
  filterSensitive,
  fromError,
  toError,
  clientInputTransformStream,
  clientOutputTransformStream,
  getHandlerTypes,
  parseHeadStream,
  promise,
  JSONRPCErrorCode,
  rpcProtocolErrors,
  isObject,
  sleep,
  never,
};
