import type { ReadableStreamDefaultReadResult } from 'stream/web';
import type {
  IdGen,
  ClientHandlerImplementation,
  DuplexHandlerImplementation,
  JSONRPCResponseError,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCResponseFailed,
  JSONRPCResponseSuccess,
  ServerManifest,
  RawHandlerImplementation,
  ServerHandlerImplementation,
  UnaryHandlerImplementation,
  RPCStream,
  MiddlewareFactory,
  FromError,
  JSONObject,
} from './types.js';
import { ReadableStream, TransformStream } from 'stream/web';
import Logger from '@matrixai/logger';
import { PromiseCancellable } from '@matrixai/async-cancellable';
import { Timer } from '@matrixai/timer';
import { startStop } from '@matrixai/async-init';
import RawHandler from './handlers/RawHandler.js';
import DuplexHandler from './handlers/DuplexHandler.js';
import ServerHandler from './handlers/ServerHandler.js';
import UnaryHandler from './handlers/UnaryHandler.js';
import ClientHandler from './handlers/ClientHandler.js';
import * as utils from './utils.js';
import * as errors from './errors.js';
import * as middleware from './middleware.js';
import * as events from './events.js';

const cleanupReason = Symbol('CleanupReason');

function composeErrorMessage(error: unknown): string {
  switch (typeof error) {
    case 'boolean':
    case 'number':
    case 'string':
    case 'bigint':
    case 'symbol':
      return `Non-error literal ${String(error)} was thrown`;
    case 'object':
      // Let the fallback handler catch null values.
      if (error == null) break;
      // If we have an error message defined, then return that.
      if ('message' in error && typeof error.message === 'string') {
        return error.message;
      }
      // If present, mention the constructor name in the message.
      if (error.constructor?.name != null) {
        return `Non-error object ${error.constructor.name} was thrown`;
      }
      // Any other values should be handled by the fallback handler.
      break;
  }

  // Handle cases where the error is not serialisable, like objects created
  // using Object.create(null). Trying to serialise this throws a TypeError.
  try {
    return `Non-error value ${String(error)} was thrown`;
  } catch (e) {
    if (e instanceof TypeError) return 'Non-error value was thrown';
    else throw e;
  }
}

/**
 * You must provide a error handler `addEventListener('error')`.
 * Otherwise errors will just be ignored.
 *
 * Events:
 * - error
 */
interface RPCServer extends startStop.StartStop {}

@startStop.StartStop({
  eventStart: events.EventRPCServerStart,
  eventStarted: events.EventRPCServerStarted,
  eventStop: events.EventRPCServerStopping,
  eventStopped: events.EventRPCServerStopped,
})
class RPCServer {
  protected idGen: IdGen;
  protected logger: Logger;
  protected handlerMap: Map<string, RawHandlerImplementation> = new Map();
  protected defaultTimeoutMap: Map<string, number | undefined> = new Map();
  protected timeoutTime: number;
  protected activeStreams: Set<PromiseCancellable<void>> = new Set();
  protected fromError: FromError;
  protected replacer?: (key: string, value: any) => any;
  protected middlewareFactory: MiddlewareFactory<
    JSONRPCRequest,
    Uint8Array,
    Uint8Array,
    JSONRPCResponseSuccess
  >;

  /**
   * RPCServer Constructor
   *
   * @param obj
   * @param obj.middlewareFactory - Middleware used to process the rpc messages.
   * The middlewareFactory needs to be a function that creates a pair of
   * transform streams that convert `Uint8Array` to `JSONRPCRequest` on the forward
   * path and `JSONRPCResponse` to `Uint8Array` on the reverse path.
   * @param obj.timeoutTime - Time before a stream is cleaned up due to no activity. This is the
   * value used if the handler doesn't specify its own timeout time. This timeout is advisory and only results in a
   * signal sent to the handler. Stream is forced to end after the timeoutForceCloseTime. Defaults to 60,000
   * milliseconds.
   * @param obj.logger
   */
  public constructor({
    middlewareFactory = middleware.defaultServerMiddlewareWrapper(),
    timeoutTime = Infinity,
    logger,
    idGen = () => null,
    fromError = utils.fromError,
    replacer,
  }: {
    middlewareFactory?: MiddlewareFactory<
      JSONRPCRequest,
      Uint8Array,
      Uint8Array,
      JSONRPCResponseSuccess
    >;
    timeoutTime?: number;
    logger?: Logger;
    idGen?: IdGen;
    fromError?: FromError;
    replacer?: (key: string, value: any) => any;
  }) {
    if (timeoutTime < 0) {
      throw new errors.ErrorRPCInvalidTimeout();
    }
    this.idGen = idGen;
    this.middlewareFactory = middlewareFactory;
    this.timeoutTime = timeoutTime;
    this.fromError = fromError;
    this.replacer = replacer;
    this.logger = logger ?? new Logger(this.constructor.name);
  }

  /**
   * Starts RPC server.

   * @param obj
   * @param obj.manifest - Server manifest used to define the rpc method handlers.
   */
  public async start({
    manifest,
  }: {
    manifest: ServerManifest;
  }): Promise<void> {
    this.logger.info(`Start ${this.constructor.name}`);
    try {
      for (const [key, manifestItem] of Object.entries(manifest)) {
        if (manifestItem.timeout != null && manifestItem.timeout < 0) {
          throw new errors.ErrorRPCInvalidHandlerTimeout();
        }
        if (manifestItem instanceof RawHandler) {
          this.registerRawStreamHandler(
            key,
            manifestItem.handle,
            manifestItem.timeout,
          );
          continue;
        }
        if (manifestItem instanceof DuplexHandler) {
          this.registerDuplexStreamHandler(
            key,
            // Bind the `this` to the generator handler to make the container available
            manifestItem.handle.bind(manifestItem),
            manifestItem.timeout,
          );
          continue;
        }
        if (manifestItem instanceof ServerHandler) {
          this.registerServerStreamHandler(
            key,
            // Bind the `this` to the generator handler to make the container available
            manifestItem.handle.bind(manifestItem),
            manifestItem.timeout,
          );
          continue;
        }
        if (manifestItem instanceof ClientHandler) {
          this.registerClientStreamHandler(
            key,
            manifestItem.handle,
            manifestItem.timeout,
          );
          continue;
        }
        if (manifestItem instanceof UnaryHandler) {
          this.registerUnaryHandler(
            key,
            manifestItem.handle,
            manifestItem.timeout,
          );
          continue;
        }
        utils.never(`manifestItem must be an instance of a Handler`);
      }
    } catch (e) {
      // No need to clean up streams, as streams can only be handled after RPCServer has been started.
      this.handlerMap.clear();
      this.defaultTimeoutMap.clear();
      throw e;
    }
    this.logger.info(`Started ${this.constructor.name}`);
  }

  public async stop({
    force = true,
    reason = new errors.ErrorRPCStopping('RPCServer is stopping'),
  }: {
    force?: boolean;
    reason?: any;
  }): Promise<void> {
    // Log an event before starting the destruction
    this.logger.info(`Stop ${this.constructor.name}`);

    // Your existing logic for stopping active streams and other cleanup
    const handlerPs = new Array<PromiseCancellable<void>>();
    for await (const [activeStream] of this.activeStreams.entries()) {
      if (force) activeStream.cancel(reason);
      handlerPs.push(activeStream);
    }
    await Promise.allSettled(handlerPs);

    // Removes handlers and default timeouts registered in `RPCServer.start()`
    this.handlerMap.clear();
    this.defaultTimeoutMap.clear();

    // Log  an event after the destruction has been completed
    this.logger.info(`Stopped ${this.constructor.name}`);
  }

  /**
   * Registers a raw stream handler. This is the basis for all handlers as
   * handling the streams is done with raw streams only.
   * The raw streams do not automatically refresh the timeout timer when
   * messages are sent or received.
   */
  protected registerRawStreamHandler(
    method: string,
    handler: RawHandlerImplementation,
    timeout: number | undefined,
  ) {
    this.handlerMap.set(method, handler);
    this.defaultTimeoutMap.set(method, timeout);
  }

  /**
   * Registers a duplex stream handler.
   * This handles all message parsing and conversion from generators
   * to raw streams.
   *
   * @param method - The rpc method name.
   * @param handler - The handler takes an input async iterable and returns an output async iterable.
   * @param timeout
   */
  /**
   * The ID is generated only once when the function is called and stored in the id variable.
   * the ID is associated with the entire stream
   * Every response (whether successful or an error) produced within this stream will have the
   * same ID, which is consistent with the originating request.
   */
  protected registerDuplexStreamHandler<
    I extends JSONObject,
    O extends JSONObject,
  >(
    method: string,
    handler: DuplexHandlerImplementation<I, O>,
    timeout: number | undefined,
  ): void {
    const rawSteamHandler: RawHandlerImplementation = async (
      [header, input],
      cancel,
      meta,
      ctx,
    ) => {
      // Setting up abort controller
      const abortController = new AbortController();
      if (ctx.signal.aborted) abortController.abort(ctx.signal.reason);
      ctx.signal.addEventListener('abort', () => {
        abortController.abort(ctx.signal.reason);
      });
      const signal = abortController.signal;
      // Setting up middleware
      const middleware = this.middlewareFactory(ctx, cancel, meta);
      // Forward from the client to the server
      // Transparent TransformStream that re-inserts the header message into the
      // stream.
      const replacer = this.replacer;
      const headerStream = new TransformStream({
        start(controller) {
          controller.enqueue(Buffer.from(JSON.stringify(header, replacer)));
        },
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      });
      const forwardStream = input
        .pipeThrough(headerStream)
        .pipeThrough(middleware.forward);
      // Reverse from the server to the client
      const reverseStream = middleware.reverse.writable;
      // Generator derived from handler
      const id = await this.idGen();
      const outputGen = async function* (): AsyncGenerator<JSONRPCResponse> {
        if (signal.aborted) throw signal.reason;
        // Input generator derived from the forward stream
        const inputGen = async function* (): AsyncIterable<I> {
          for await (const data of forwardStream) {
            yield data.params as I;
          }
        };
        const handlerG = handler(inputGen(), cancel, meta, {
          signal,
          timer: ctx.timer,
        });
        for await (const response of handlerG) {
          if (ctx.timer.status !== 'settled') {
            ctx.timer.cancel(utils.timeoutCancelledReason);
          }
          const responseMessage: JSONRPCResponseSuccess = {
            jsonrpc: '2.0',
            result: response,
            id,
          };
          yield responseMessage;
        }
      };
      const outputGenerator = outputGen();
      const reverseMiddlewareStream = new ReadableStream<JSONRPCResponse>({
        pull: async (controller) => {
          try {
            const { value, done } = await outputGenerator.next();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          } catch (e) {
            try {
              const rpcError: JSONRPCResponseError = {
                code: errors.JSONRPCResponseErrorCode.RPCRemote,
                message: composeErrorMessage(e),
                data: this.fromError(e),
              };
              const rpcErrorMessage: JSONRPCResponseFailed = {
                jsonrpc: '2.0',
                error: rpcError,
                id,
              };
              controller.enqueue(rpcErrorMessage);
            } catch (e) {
              this.dispatchEvent(
                new events.RPCErrorEvent({
                  detail: e,
                }),
              );
              controller.error(e);
            }
            // Clean up the input stream here, ignore error if already ended
            await forwardStream
              .cancel(
                new errors.ErrorRPCHandlerFailed('Error clean up', {
                  cause: e,
                }),
              )
              .catch(() => {});
            controller.close();
          }
        },
        cancel: async (reason) => {
          this.dispatchEvent(
            new events.RPCErrorEvent({
              detail: new errors.ErrorRPCStreamEnded(
                'Stream has been cancelled',
                {
                  cause: reason,
                },
              ),
            }),
          );
          // Abort with the reason
          abortController.abort(reason);
          // If the output stream path fails then we need to end the generator
          // early.
          await outputGenerator.return(undefined);
        },
      });
      // Ignore any errors here, it should propagate to the ends of the stream
      void reverseMiddlewareStream.pipeTo(reverseStream).catch(() => {});
      return [undefined, middleware.reverse.readable];
    };
    this.registerRawStreamHandler(method, rawSteamHandler, timeout);
  }

  protected registerUnaryHandler<I extends JSONObject, O extends JSONObject>(
    method: string,
    handler: UnaryHandlerImplementation<I, O>,
    timeout: number | undefined,
  ) {
    const wrapperDuplex: DuplexHandlerImplementation<I, O> = async function* (
      input,
      cancel,
      meta,
      ctx,
    ) {
      // The `input` is expected to be an async iterable with only 1 value.
      // Unlike generators, there is no `next()` method.
      // So we use `break` after the first iteration.
      for await (const inputVal of input) {
        yield await handler(inputVal, cancel, meta, ctx);
        break;
      }
      // Noop so that stream can close after flushing
      for await (const _ of input);
    };
    this.registerDuplexStreamHandler(method, wrapperDuplex, timeout);
  }

  protected registerServerStreamHandler<
    I extends JSONObject,
    O extends JSONObject,
  >(
    method: string,
    handler: ServerHandlerImplementation<I, O>,
    timeout: number | undefined,
  ) {
    const wrapperDuplex: DuplexHandlerImplementation<I, O> = async function* (
      input,
      cancel,
      meta,
      ctx,
    ) {
      for await (const inputVal of input) {
        yield* handler(inputVal, cancel, meta, ctx);
        break;
      }
    };
    this.registerDuplexStreamHandler(method, wrapperDuplex, timeout);
  }

  protected registerClientStreamHandler<
    I extends JSONObject,
    O extends JSONObject,
  >(
    method: string,
    handler: ClientHandlerImplementation<I, O>,
    timeout: number | undefined,
  ) {
    const wrapperDuplex: DuplexHandlerImplementation<I, O> = async function* (
      input,
      cancel,
      meta,
      ctx,
    ) {
      yield await handler(input, cancel, meta, ctx);
    };
    this.registerDuplexStreamHandler(method, wrapperDuplex, timeout);
  }

  /**
   * ID is associated with the stream, not individual messages.
   */
  @startStop.ready(new errors.ErrorRPCServerNotRunning())
  public handleStream(rpcStream: RPCStream<Uint8Array, Uint8Array>) {
    // This will take a buffer stream of json messages and set up service
    //  handling for it.
    // Constructing the PromiseCancellable for tracking the active stream
    const abortController = new AbortController();
    // Setting up timeout timer logic
    const timer = new Timer({
      delay: this.timeoutTime,
      handler: () => {
        abortController.abort(new errors.ErrorRPCTimedOut());
      },
    });

    const prom = (async () => {
      const id = await this.idGen();
      const transformStream = middleware.binaryToJsonHeaderMessageStream(
        utils.parseJSONRPCRequest,
      );
      // Transparent transform used as a point to cancel the input stream from
      const passthroughTransform = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const inputStreamEndProm = rpcStream.readable
        .pipeTo(passthroughTransform.writable)
        // Ignore any errors here, we only care that it ended
        .catch(() => {});
      const cleanUp = async (reason: any) => {
        // Release resources
        await transformStream.readable.cancel(reason);
        await rpcStream.writable.abort(reason);
        await inputStreamEndProm;
        // Stop the timer
        timer.cancel(cleanupReason);
        await timer.catch(() => {});
      };
      passthroughTransform.readable
        .pipeTo(transformStream.writable)
        .catch(() => {});
      const reader = transformStream.readable.getReader();
      // Allows timing out when waiting for the first message
      let headerMessage:
        | ReadableStreamDefaultReadResult<JSONRPCRequest | Uint8Array>
        | undefined;
      try {
        headerMessage = await Promise.race([
          reader.read(),
          timer.then(
            () => undefined,
            () => undefined,
          ),
        ]);
      } catch (e) {
        const err = new errors.ErrorRPCHandlerFailed(
          'Stream failed waiting for header',
          { cause: e },
        );
        await inputStreamEndProm;
        timer.cancel(cleanupReason);
        await timer.catch(() => {});
        this.dispatchEvent(
          new events.RPCErrorEvent({
            detail: new errors.ErrorRPCOutputStreamError(
              'Stream failed waiting for header',
              { cause: err },
            ),
          }),
        );
        return;
      }
      // Downgrade back to the raw stream
      reader.releaseLock();
      // There are 2 conditions where we just end here
      //  1. The timeout timer resolves before the first message
      //  2. the stream ends before the first message
      if (headerMessage == null) {
        const err = new errors.ErrorRPCTimedOut(
          'Timed out waiting for header',
          { cause: new errors.ErrorRPCStreamEnded() },
        );
        await cleanUp(err);
        this.dispatchEvent(
          new events.RPCErrorEvent({
            detail: new errors.ErrorRPCTimedOut(
              'Timed out waiting for header',
              {
                cause: err,
              },
            ),
          }),
        );
        return;
      }
      if (headerMessage.done) {
        const err = new errors.ErrorMissingHeader('Missing header');
        await cleanUp(err);
        this.dispatchEvent(
          new events.RPCErrorEvent({
            detail: new errors.ErrorRPCOutputStreamError(),
          }),
        );
        return;
      }
      if (headerMessage.value instanceof Uint8Array) {
        const err = new errors.ErrorRPCParse('Invalid message type');
        await cleanUp(err);
        this.dispatchEvent(
          new events.RPCErrorEvent({
            detail: new errors.ErrorRPCParse(),
          }),
        );
        return;
      }
      const method = headerMessage.value.method;
      const handler = this.handlerMap.get(method);
      if (handler == null) {
        await cleanUp(
          new errors.ErrorRPCHandlerFailed(`Missing handler for ${method}`),
        );
        return;
      }
      if (abortController.signal.aborted) {
        await cleanUp(
          new errors.ErrorHandlerAborted('Aborted', {
            cause: new errors.ErrorHandlerAborted(),
          }),
        );
        return;
      }
      // Setting up Timeout logic
      const timeout = this.defaultTimeoutMap.get(method);
      if (timer.status !== 'settled') {
        if (timeout != null) {
          // Reset timeout with new delay if it is less than the default
          timer.reset(timeout);
        } else {
          // Otherwise refresh
          timer.refresh();
        }
      }
      this.logger.info(`Handling stream with method (${method})`);
      let handlerResult: [JSONObject | undefined, ReadableStream<Uint8Array>];
      const headerWriter = rpcStream.writable.getWriter();
      try {
        // The as keyword is used here as the middleware will only return the
        // first message as a JSONMessage, and others as raw Uint8Arrays.
        handlerResult = await handler(
          [
            headerMessage.value,
            transformStream.readable as ReadableStream<Uint8Array>,
          ],
          rpcStream.cancel,
          rpcStream.meta,
          { signal: abortController.signal, timer },
        );
      } catch (e) {
        try {
          const rpcError: JSONRPCResponseError = {
            code: errors.JSONRPCResponseErrorCode.RPCRemote,
            message: composeErrorMessage(e),
            data: this.fromError(e),
          };
          const rpcErrorMessage: JSONRPCResponseFailed = {
            jsonrpc: '2.0',
            error: rpcError,
            id,
          };
          await headerWriter.write(
            Buffer.from(JSON.stringify(rpcErrorMessage, this.replacer)),
          );
          await headerWriter.close();
        } catch (e) {
          this.dispatchEvent(
            new events.RPCErrorEvent({
              detail: e,
            }),
          );
          await headerWriter.abort(e);
        }
        // Clean up and return
        timer.cancel(cleanupReason);
        rpcStream.cancel(Error('TMP header message was an error'));
        return;
      }
      const [leadingResult, outputStream] = handlerResult;

      if (leadingResult !== undefined) {
        // Writing leading metadata
        const leadingMessage: JSONRPCResponseSuccess = {
          jsonrpc: '2.0',
          result: leadingResult,
          id,
        };
        await headerWriter.write(
          Buffer.from(JSON.stringify(leadingMessage, this.replacer)),
        );
      }
      headerWriter.releaseLock();
      const outputStreamEndProm = outputStream
        .pipeTo(rpcStream.writable)
        .catch(() => {}); // Ignore any errors, we only care that it finished
      await Promise.allSettled([inputStreamEndProm, outputStreamEndProm]);
      this.logger.info(`Handled stream with method (${method})`);
      // Cleaning up abort and timer
      timer.cancel(cleanupReason);
      abortController.abort(new errors.ErrorRPCStreamEnded());
    })();
    const handlerProm = PromiseCancellable.from(prom, abortController).finally(
      () => this.activeStreams.delete(handlerProm),
      abortController,
    );
    // Putting the PromiseCancellable into the active streams map
    this.activeStreams.add(handlerProm);
  }
}

export default RPCServer;
