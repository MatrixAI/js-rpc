import type {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCResponseResult,
  MiddlewareFactory,
  JSONValue,
  JSONRPCRequestMetadata,
  JSONRPCResponseMetadata,
} from './types';
import type { ContextTimed } from '@matrixai/contexts';
import { TransformStream } from 'stream/web';
import { JSONParser } from '@streamparser/json';
import * as utils from './utils';
import * as rpcErrors from './errors';

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
function binaryToJsonMessageStream<T extends JSONRPCMessage>(
  messageParser: (message: unknown) => T,
  bufferByteLimit: number = 1024 * 1024,
): TransformStream<Uint8Array, T> {
  const parser = new JSONParser({
    separator: '',
    paths: ['$'],
  });
  let bytesWritten: number = 0;

  return new TransformStream<Uint8Array, T>({
    flush: async () => {
      // Avoid potential race conditions by allowing parser to end first
      const waitP = utils.promise();
      parser.onEnd = () => waitP.resolveP();
      parser.end();
      await waitP.p;
    },
    start: (controller) => {
      parser.onValue = (value) => {
        const jsonMessage = messageParser(value.value);
        controller.enqueue(jsonMessage);
        bytesWritten = 0;
      };
    },
    transform: (chunk) => {
      try {
        bytesWritten += chunk.byteLength;
        parser.write(chunk);
      } catch (e) {
        throw new rpcErrors.ErrorRPCParse(undefined, { cause: e });
      }
      if (bytesWritten > bufferByteLimit) {
        throw new rpcErrors.ErrorRPCMessageLength();
      }
    },
  });
}

/**
 * This function is a factory for a TransformStream that will transform
 * JsonRPCMessages into the `Uint8Array` form. This is used for the stream
 * output.
 */
function jsonMessageToBinaryStream(): TransformStream<
  JSONRPCMessage,
  Uint8Array
> {
  return new TransformStream<JSONRPCMessage, Uint8Array>({
    transform: (chunk, controller) => {
      controller.enqueue(Buffer.from(JSON.stringify(chunk)));
    },
  });
}

function timeoutMiddlewareServer(
  ctx: ContextTimed,
  _cancel: (reason?: any) => void,
  _meta: Record<string, JSONValue> | undefined,
) {
  const currentTimeout = ctx.timer.delay;
  // Flags for tracking if the first message has been processed
  let forwardFirst = true;
  return {
    forward: new TransformStream<
      JSONRPCRequest<JSONRPCRequestMetadata>,
      JSONRPCRequest<JSONRPCRequestMetadata>
    >({
      transform: (chunk, controller) => {
        controller.enqueue(chunk);
        if (forwardFirst) {
          forwardFirst = false;
          let clientTimeout = chunk.metadata?.timeout;
          if (clientTimeout === undefined) return;
          if (clientTimeout === null) clientTimeout = Infinity;
          if (clientTimeout < currentTimeout) ctx.timer.reset(clientTimeout);
        }
      },
    }),
    reverse: new TransformStream<
      JSONRPCResponse<JSONRPCResponseMetadata>,
      JSONRPCResponse<JSONRPCResponseMetadata>
    >({
      transform: (chunk, controller) => {
        // Passthrough chunk, no need for server to send ctx.timeout
        controller.enqueue(chunk);
      },
    }),
  };
}

/**
 * This adds its own timeout to the forward metadata and updates it's timeout
 * based on the reverse metadata.
 * @param ctx
 * @param _cancel
 * @param _meta
 */
function timeoutMiddlewareClient(
  ctx: ContextTimed,
  _cancel: (reason?: any) => void,
  _meta: Record<string, JSONValue> | undefined,
) {
  const currentTimeout = ctx.timer.delay;
  // Flags for tracking if the first message has been processed
  let forwardFirst = true;
  return {
    forward: new TransformStream<JSONRPCRequest, JSONRPCRequest>({
      transform: (chunk, controller) => {
        if (forwardFirst) {
          forwardFirst = false;
          if (chunk == null) chunk = { jsonrpc: '2.0', method: '' };
          if (chunk.metadata == null) chunk.metadata = {};
          (chunk.metadata as any).timeout = currentTimeout;
        }
        controller.enqueue(chunk);
      },
    }),
    reverse: new TransformStream<
      JSONRPCResponse<JSONRPCResponseMetadata>,
      JSONRPCResponse<JSONRPCResponseMetadata>
    >({
      transform: (chunk, controller) => {
        controller.enqueue(chunk); // Passthrough chunk, no need for client to set ctx.timeout
      },
    }),
  };
}

/**
 * This function is a factory for creating a pass-through streamPair. It is used
 * as the default middleware for the middleware wrappers.
 */
function defaultMiddleware() {
  return {
    forward: new TransformStream<JSONRPCRequest, JSONRPCRequest>(),
    reverse: new TransformStream<JSONRPCResponse, JSONRPCResponse>(),
  };
}

/**
 * This convenience factory for creating wrapping middleware with the basic
 * message processing and parsing for the server middleware.
 * In the forward path, it will transform the binary stream into the validated
 * JsonRPCMessages and pipe it through the provided middleware.
 * The reverse path will pipe the output stream through the provided middleware
 * and then transform it back to a binary stream.
 * @param middlewareFactory - The provided middleware
 * @param parserBufferByteLimit
 */
function defaultServerMiddlewareWrapper(
  middlewareFactory: MiddlewareFactory<
    JSONRPCRequest,
    JSONRPCRequest,
    JSONRPCResponse,
    JSONRPCResponse
  > = defaultMiddleware,
  parserBufferByteLimit: number = 1024 * 1024,
): MiddlewareFactory<JSONRPCRequest, Uint8Array, Uint8Array, JSONRPCResponse> {
  return (ctx, cancel, meta) => {
    const inputTransformStream = binaryToJsonMessageStream(
      utils.parseJSONRPCRequest,
      parserBufferByteLimit,
    );
    const outputTransformStream = new TransformStream<
      JSONRPCResponseResult,
      JSONRPCResponseResult
    >();

    const middleMiddleware = middlewareFactory(ctx, cancel, meta);
    const timeoutMiddleware = timeoutMiddlewareServer(ctx, cancel, meta);

    const forwardReadable = inputTransformStream.readable
      .pipeThrough(timeoutMiddleware.forward) // Timeout middleware here
      .pipeThrough(middleMiddleware.forward); // Usual middleware here
    const reverseReadable = outputTransformStream.readable
      .pipeThrough(middleMiddleware.reverse) // Usual middleware here
      .pipeThrough(timeoutMiddleware.reverse) // Timeout middleware here
      .pipeThrough(jsonMessageToBinaryStream());

    return {
      forward: {
        readable: forwardReadable,
        writable: inputTransformStream.writable,
      },
      reverse: {
        readable: reverseReadable,
        writable: outputTransformStream.writable,
      },
    };
  };
}

/**
 * This convenience factory for creating wrapping middleware with the basic
 * message processing and parsing for the server middleware.
 * The forward path will pipe the input through the provided middleware and then
 * transform it to the binary stream.
 * The reverse path will parse and validate the output and pipe it through the
 * provided middleware.
 * @param middleware - the provided middleware
 * @param parserBufferByteLimit - Max number of bytes to buffer when parsing the stream. Exceeding this results in an
 * `ErrorRPCMessageLength` error.
 */
const defaultClientMiddlewareWrapper = (
  middleware: MiddlewareFactory<
    JSONRPCRequest,
    JSONRPCRequest,
    JSONRPCResponse,
    JSONRPCResponse
  > = defaultMiddleware,
  parserBufferByteLimit?: number,
): MiddlewareFactory<
  Uint8Array,
  JSONRPCRequest,
  JSONRPCResponse,
  Uint8Array
> => {
  return (ctx, cancel, meta) => {
    const outputTransformStream = binaryToJsonMessageStream(
      utils.parseJSONRPCResponse,
      parserBufferByteLimit,
    );
    const inputTransformStream = new TransformStream<
      JSONRPCRequest,
      JSONRPCRequest
    >();

    const timeoutMiddleware = timeoutMiddlewareClient(ctx, cancel, meta);
    const middleMiddleware = middleware(ctx, cancel, meta);
    const forwardReadable = inputTransformStream.readable
      .pipeThrough(timeoutMiddleware.forward)
      .pipeThrough(middleMiddleware.forward) // Usual middleware here
      .pipeThrough(jsonMessageToBinaryStream());
    const reverseReadable = outputTransformStream.readable
      .pipeThrough(middleMiddleware.reverse)
      .pipeThrough(timeoutMiddleware.reverse); // Usual middleware here

    return {
      forward: {
        readable: forwardReadable,
        writable: inputTransformStream.writable,
      },
      reverse: {
        readable: reverseReadable,
        writable: outputTransformStream.writable,
      },
    };
  };
};

export {
  binaryToJsonMessageStream,
  jsonMessageToBinaryStream,
  timeoutMiddlewareClient,
  timeoutMiddlewareServer,
  defaultMiddleware,
  defaultServerMiddlewareWrapper,
  defaultClientMiddlewareWrapper,
};
