import type { Timer } from '@matrixai/timer';
import type {
  ClientManifest,
  HandlerType,
  JSONObject,
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCRequestMessage,
  JSONRPCRequestNotification,
  JSONRPCResponse,
  JSONRPCResponseError,
  JSONRPCResponseResult,
  JSONValue,
  PromiseDeconstructed,
  ToError,
} from './types';
import { TransformStream } from 'stream/web';
import { JSONParser } from '@streamparser/json';
import { AbstractError } from '@matrixai/errors';
import * as errors from './errors';

const timeoutCancelledReason = Symbol('timeoutCancelledReason');

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

function parseJSONRPCRequest<T extends JSONObject>(
  message: unknown,
): JSONRPCRequest<T> {
  if (!isObject(message)) {
    throw new errors.ErrorRPCParse('must be a JSON POJO');
  }
  if (!('method' in message)) {
    throw new errors.ErrorRPCParse('`method` property must be defined');
  }
  if (typeof message.method !== 'string') {
    throw new errors.ErrorRPCParse('`method` property must be a string');
  }
  // If ('params' in message && !utils.isObject(message.params)) {
  //   throw new rpcErrors.ErrorRPCParse('`params` property must be a POJO');
  // }
  return message as JSONRPCRequest<T>;
}

function parseJSONRPCRequestMessage<T extends JSONObject>(
  message: unknown,
): JSONRPCRequestMessage<T> {
  const jsonRequest = parseJSONRPCRequest(message);
  if (!('id' in jsonRequest)) {
    throw new errors.ErrorRPCParse('`id` property must be defined');
  }
  if (
    typeof jsonRequest.id !== 'string' &&
    typeof jsonRequest.id !== 'number' &&
    jsonRequest.id !== null
  ) {
    throw new errors.ErrorRPCParse(
      '`id` property must be a string, number or null',
    );
  }
  return jsonRequest as JSONRPCRequestMessage<T>;
}

function parseJSONRPCRequestNotification<T extends JSONObject>(
  message: unknown,
): JSONRPCRequestNotification<T> {
  const jsonRequest = parseJSONRPCRequest(message);
  if ('id' in jsonRequest) {
    throw new errors.ErrorRPCParse('`id` property must not be defined');
  }
  return jsonRequest as JSONRPCRequestNotification<T>;
}

function parseJSONRPCResponseResult<T extends JSONObject>(
  message: unknown,
): JSONRPCResponseResult<T> {
  if (!isObject(message)) {
    throw new errors.ErrorRPCParse('must be a JSON POJO');
  }
  if (!('result' in message)) {
    throw new errors.ErrorRPCParse('`result` property must be defined');
  }
  if ('error' in message) {
    throw new errors.ErrorRPCParse('`error` property must not be defined');
  }
  // If (!utils.isObject(message.result)) {
  //   throw new rpcErrors.ErrorRPCParse('`result` property must be a POJO');
  // }
  if (!('id' in message)) {
    throw new errors.ErrorRPCParse('`id` property must be defined');
  }
  if (
    typeof message.id !== 'string' &&
    typeof message.id !== 'number' &&
    message.id !== null
  ) {
    throw new errors.ErrorRPCParse(
      '`id` property must be a string, number or null',
    );
  }
  return message as JSONRPCResponseResult<T>;
}

function parseJSONRPCResponseError(message: unknown): JSONRPCResponseError {
  if (!isObject(message)) {
    throw new errors.ErrorRPCParse('must be a JSON POJO');
  }
  if ('result' in message) {
    throw new errors.ErrorRPCParse('`result` property must not be defined');
  }
  if (!('error' in message)) {
    throw new errors.ErrorRPCParse('`error` property must be defined');
  }
  parseJSONRPCError(message.error);
  if (!('id' in message)) {
    throw new errors.ErrorRPCParse('`id` property must be defined');
  }
  if (
    typeof message.id !== 'string' &&
    typeof message.id !== 'number' &&
    message.id !== null
  ) {
    throw new errors.ErrorRPCParse(
      '`id` property must be a string, number or null',
    );
  }
  return message as JSONRPCResponseError;
}

function parseJSONRPCError(message: unknown): JSONRPCError {
  if (!isObject(message)) {
    throw new errors.ErrorRPCParse('must be a JSON POJO');
  }
  if (!('code' in message)) {
    throw new errors.ErrorRPCParse('`code` property must be defined');
  }
  if (typeof message.code !== 'number') {
    throw new errors.ErrorRPCParse('`code` property must be a number');
  }
  if (!('message' in message)) {
    throw new errors.ErrorRPCParse('`message` property must be defined');
  }
  if (typeof message.message !== 'string') {
    throw new errors.ErrorRPCParse('`message` property must be a string');
  }
  // If ('data' in message && !utils.isObject(message.data)) {
  //   throw new rpcErrors.ErrorRPCParse('`data` property must be a POJO');
  // }
  return message as JSONRPCError;
}

function parseJSONRPCResponse<T extends JSONObject>(
  message: unknown,
): JSONRPCResponse<T> {
  if (!isObject(message)) {
    throw new errors.ErrorRPCParse('must be a JSON POJO');
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
  throw new errors.ErrorRPCParse('structure did not match a `JSONRPCResponse`');
}

function parseJSONRPCMessage<T extends JSONObject>(
  message: unknown,
): JSONRPCMessage<T> {
  if (!isObject(message)) {
    throw new errors.ErrorRPCParse('must be a JSON POJO');
  }
  if (!('jsonrpc' in message)) {
    throw new errors.ErrorRPCParse('`jsonrpc` property must be defined');
  }
  if (message.jsonrpc !== '2.0') {
    throw new errors.ErrorRPCParse(
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
  throw new errors.ErrorRPCParse(
    'Message structure did not match a `JSONRPCMessage`',
  );
}
/**
 * Serializes an Error instance into a JSONValue object suitable for RPC.
 * @param {Error} error - The Error instance to serialize.
 * @returns {JSONValue} The serialized ErrorRPC instance.
 * @throws {TypeError} If the error is an instance of {@link Symbol}, {@link BigInt} or {@link Function}.
 */
function fromError(error: any): JSONValue {
  // TODO: Linked-List traversal must be done iteractively rather than recusively to prevent stack overflow.
  switch (typeof error) {
    case 'symbol':
    case 'bigint':
    case 'function':
      throw TypeError(`${error} cannot be serialized`);
  }

  if (error instanceof Error) {
    const cause = fromError(error.cause);
    const timestamp: string = ((error as any).timestamp ?? new Date()).toJSON();
    if (error instanceof AbstractError) {
      return error.toJSON();
    } else if (error instanceof AggregateError) {
      // AggregateError has an `errors` property
      return {
        type: error.constructor.name,
        message: error.message,
        data: {
          errors: error.errors.map(fromError),
          stack: error.stack,
          timestamp,
          cause,
        },
      };
    }

    // If it's some other type of error then only serialise the message and
    // stack (and the type of the error)
    return {
      type: error.name,
      message: error.message,
      data: {
        stack: error.stack,
        timestamp,
        cause,
      },
    };
  }

  return error;
}

/**
 * Error constructors for non-Polykey rpcErrors
 * Allows these rpcErrors to be reconstructed from RPC metadata
 */
const standardErrors: {
  [key: string]: typeof Error | typeof AggregateError | typeof AbstractError;
} = {
  Error,
  TypeError,
  SyntaxError,
  ReferenceError,
  EvalError,
  RangeError,
  URIError,
  AggregateError,
  AbstractError,
  ErrorRPCTimedOut: errors.ErrorRPCTimedOut,
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
      if (value instanceof errors.ErrorRPCProtocol) {
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

/**
 * Deserializes an error response object into an ErrorRPCRemote instance.
 * @param {JSONValue} errorData - The error data object.
 * @param clientMetadata
 * @param top
 * @returns {any} The deserialized error.
 */
function toError(
  errorData: JSONValue,
  clientMetadata: JSONValue,
  top: boolean = true,
): any {
  // If the value is an error then reconstruct it
  if (
    errorData != null &&
    typeof errorData === 'object' &&
    'type' in errorData &&
    typeof errorData.type === 'string' &&
    'data' in errorData &&
    typeof errorData.data === 'object'
  ) {
    try {
      const eClass = standardErrors[errorData.type];
      if (eClass != null) {
        let e: Error;
        switch (eClass) {
          case AbstractError:
          case errors.ErrorRPCTimedOut:
            e = eClass.fromJSON(errorData);
            break;
          case AggregateError:
            if (
              errorData.data == null ||
              !('errors' in errorData.data) ||
              !Array.isArray(errorData.data.errors) ||
              typeof errorData.message !== 'string' ||
              !('stack' in errorData.data) ||
              typeof errorData.data.stack !== 'string'
            ) {
              throw new TypeError(`cannot decode JSON to ${errorData.type}`);
            }
            e = new eClass(
              errorData.data.errors.map((data) =>
                toError(data, clientMetadata, false),
              ),
              errorData.message,
            );
            e.stack = errorData.data.stack;
            break;
          default:
            if (
              errorData.data == null ||
              typeof errorData.message !== 'string' ||
              !('stack' in errorData.data) ||
              typeof errorData.data.stack !== 'string'
            ) {
              throw new TypeError(`Cannot decode JSON to ${errorData.type}`);
            }
            e = new (eClass as typeof Error)(errorData.message);
            e.stack = errorData.data.stack;
            break;
        }
        if (errorData.data != null && 'cause' in errorData.data) {
          e.cause = toError(errorData.data.cause, clientMetadata, false);
        }
        if (top) {
          const err = new errors.ErrorRPCRemote(clientMetadata, undefined, {
            cause: e,
          });
          return err;
        } else {
          return e;
        }
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
 */
function clientInputTransformStream<I extends JSONObject>(
  method: string,
): TransformStream<I, JSONRPCRequest> {
  return new TransformStream<I, JSONRPCRequest>({
    transform: (chunk, controller) => {
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
 * @param toError
 * @param timer - Timer that gets refreshed each time a message is provided.
 */
function clientOutputTransformStream<O extends JSONObject>(
  clientMetadata: JSONValue,
  toError: ToError,
  timer?: Timer,
): TransformStream<JSONRPCResponse<O>, O> {
  return new TransformStream<JSONRPCResponse<O> | JSONRPCResponseError, O>({
    transform: (chunk, controller) => {
      if (timer?.status !== 'settled') {
        timer?.cancel(timeoutCancelledReason);
      }
      // `error` indicates it's an error message
      if ('error' in chunk) {
        const e = toError(chunk.error.data, clientMetadata);
        controller.error(e);
      } else {
        chunk.result;
        controller.enqueue(chunk.result as O);
      }
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
            throw new errors.ErrorRPCParse(undefined, {
              cause: e,
            });
          }
          if (bytesWritten > bufferByteLimit) {
            throw new errors.ErrorRPCMessageLength();
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
  throw new errors.ErrorRPC('This function should never be called');
}

export {
  timeoutCancelledReason,
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
  isObject,
  sleep,
  never,
};
